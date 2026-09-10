/**
 * combat/kill.ts — THE mob kill path (M6 §2.3 / D89).
 *
 * `castAbility` (the melee fallback the web client still ships) and the new
 * `castAbilityById` both end here. This file is the ONLY place in the module
 * that inserts into `mobRespawnQueue`, and the only place that deletes a mob
 * row *as a kill* — the two other `mob.mobId.delete` callsites in `index.ts`
 * (seedWorld's self-heal pass and dungeon-instance cleanup) are administrative
 * removals, are marked with the `NON-KILL MOB DELETE` marker comment, and are
 * asserted as such by `killPathShared.test.ts`.
 *
 * The reason for the extraction is drift: loot rolls and quest kill credit are
 * easy to update in one reducer and forget in the other, and the failure is
 * silent (a player kills a wolf with an ability and their quest counter does
 * not move). One function, two callers, no divergence.
 *
 * `creditKillToQuests` is injected rather than imported because it lives in
 * `index.ts` alongside the quest-state constants; importing it here would
 * create an import cycle with the schema module.
 */

import { MOBS } from '../content/index.js';
import {
  grantMobLoot,
  lootSeedFromKill,
  type InventoryCtx,
} from '../inventory/helpers.js';
import { refreshCollectQuestProgress } from '../quests/collect.js';
import { emitCombatEvent } from './events.js';

export type KillCtx = {
  db: any;
};

/** The subset of a `mob` row the kill path needs. */
export interface KilledMob {
  mobId: bigint;
  mobType: string;
  spawnNetId: string;
  dungeonInstanceId: bigint;
  respawnSec: number;
}

export type CreditKillToQuests = (
  ctx: any,
  identity: any,
  mob: { mobType: string; spawnNetId: string; dungeonInstanceId: bigint },
) => void;

/**
 * Kill `mob`, crediting `killer`.
 *
 * Order is verbatim the pre-M6 `castAbility` kill block (index.ts:1396-1418 on
 * `main`): schedule the respawn, delete the row (the client sees `onDelete`),
 * credit quests, then roll loot. `scheduleAtTime` is passed in so this file
 * never imports the SpacetimeDB SDK — it stays a plain function the root
 * vitest can read and reason about.
 *
 * `abilityId` is only used for the emitted `kill` event; pass '' for the
 * melee fallback so the client can tell the two apart.
 *
 * `creditKill` exists for the dot-kill case (M6-4 review M-4). A scheduled
 * reducer has no player sender, so `tickAuras` can only pass the MODULE's own
 * identity as the killer. Running the loot/quest half with that identity
 * materialises `playerWallet` / `playerItemStack` / quest-progress rows owned
 * by a non-player identity — rows nothing ever reads and nothing ever reaps.
 * With `creditKill: false` the mob still dies and still respawns; nobody is
 * credited, which is the already-recorded `mobAura.appliedBy` gap, not a new
 * one. Returns the `mobAura` ids it deleted so a caller iterating a snapshot
 * can skip them (review M-1).
 */
export function applyMobKill(
  ctx: KillCtx,
  killer: any,
  mob: KilledMob,
  nowMicros: bigint,
  scheduleAtTime: (atMicros: bigint) => unknown,
  creditKillToQuests: CreditKillToQuests,
  abilityId: string = '',
  creditKill: boolean = true,
): bigint[] {
  const respawnAt = nowMicros + BigInt(mob.respawnSec) * 1_000_000n;
  ctx.db.mobRespawnQueue.insert({
    id: 0n, // auto-inc replaces this
    scheduledAt: scheduleAtTime(respawnAt),
    spawnNetId: mob.spawnNetId,
    dungeonInstanceId: mob.dungeonInstanceId,
  });
  ctx.db.mob.mobId.delete(mob.mobId);

  if (creditKill) {
    // P1 quest hook: kill credit goes to whoever lands the killing blow
    // (tap rights / party sharing arrive with P6).
    creditKillToQuests(ctx, killer, mob);

    // P4: mob loot + copper to the killer.
    const mobDef = MOBS[mob.mobType];
    if (mobDef) {
      const seed = lootSeedFromKill(killer, mob.mobId, nowMicros, mob.spawnNetId);
      grantMobLoot(ctx as InventoryCtx, killer, mobDef, seed);
      refreshCollectQuestProgress(ctx as InventoryCtx, killer);
    }
  }

  // M6 §2.6 — the client's death/kill feedback reads this, not an hp delta
  // (the row is gone by the time the delete lands, so there is no final hp).
  emitCombatEvent(ctx, {
    at: nowMicros,
    actor: killer,
    abilityId,
    targetMobId: mob.mobId,
    kind: 'kill',
  });

  // Auras attached to a dead mob would otherwise outlive it and tick against
  // a missing row every second until they expire.
  return clearMobAuras(ctx, mob.mobId);
}

/** Drop every `mobAura` row belonging to `mobId`; returns the ids removed. */
export function clearMobAuras(ctx: KillCtx, mobId: bigint): bigint[] {
  const doomed: bigint[] = [];
  for (const row of ctx.db.mobAura.iter()) {
    if (row.mobId === mobId) doomed.push(row.id);
  }
  for (const id of doomed) ctx.db.mobAura.id.delete(id);
  return doomed;
}
