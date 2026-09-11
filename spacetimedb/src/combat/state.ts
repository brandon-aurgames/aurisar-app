/**
 * combat/state.ts — the impure glue the canonical resolver refuses (M6 §2.2).
 *
 * `content/formulas/abilityResolve.ts` is pure data-in/data-out: no `ctx`, no
 * clock, no tables. This file is the other half — it reads live rows and
 * assembles the `CasterState` / `TargetState` the resolver expects.
 *
 * D82: there is no `attributes` column on `player` and M6 does not add one
 * (M8's character sheet re-specifies attributes; a fifth append to a live
 * maincloud table for a system about to change is a bad trade). The honest
 * attribute source today is equipped gear — `playerEquipped` joined to
 * `ITEMS[itemId].gameStats`, which `extends AttributeBlock`. A player with
 * nothing equipped has an empty attribute block, which is exactly true.
 *
 * NOTE: the M6 architecture handoff writes this join as `ITEMS[id].stats`.
 * The real field is `gameStats` (`content/types.ts:129` — `ItemDef.gameStats?:
 * ItemGameStats`); there is no `stats` field on `ItemDef`.
 *
 * D83: `MobDef` has `level`, `maxHp`, `dmgMin`, `dmgMax` and no armor field,
 * so mob armor is 0 in M6 — stated once, here, instead of as a bare literal.
 */

import { ABILITIES, CLASS_KITS, MOBS } from '../content/index.js';
import { ITEMS } from '../content/items/index.js';
import type {
  AbilityDef,
  AttributeBlock,
  AttributeKey,
  ClassId,
} from '../content/types.js';
import { deriveStats } from '../content/formulas/combat.js';
import type {
  CasterState,
  TargetState,
} from '../content/formulas/abilityResolve.js';

export type CombatStateCtx = { db: any };

/** 1 world meter = 32 STDB px — mirrors `index.ts` PX_PER_M / worldSpace.js. */
export const PX_PER_M = 32;

/**
 * Fists. Named rather than a literal at the call site so the "what does an
 * unarmed player swing for" answer has one home.
 */
export const UNARMED_WEAPON = { dmgMin: 1, dmgMax: 3, speedSec: 2.0 };

/** Mobs carry no armor stat in content (D83). */
export const MOB_ARMOR = 0;

const ATTRIBUTE_KEYS: AttributeKey[] = [
  'STR', 'END', 'DEX', 'CON', 'INT', 'CHA', 'WIS', 'VIT',
];

export function abilityById(abilityId: string): AbilityDef | undefined {
  return ABILITIES[abilityId];
}

/** `player.classType` is a free string column; only known kits resolve. */
export function classIdOf(classType: string): ClassId | null {
  return Object.prototype.hasOwnProperty.call(CLASS_KITS, classType)
    ? (classType as ClassId)
    : null;
}

/**
 * ONE pass over `playerEquipped` per cast (M6-4 review L-1).
 *
 * `playerEquipped` has no index by owner, so every helper that "just needs the
 * attributes" or "just needs the weapon" costs a full table scan. The cast path
 * needs attributes, the weapon band AND the resource pool, so it takes this
 * snapshot once and every consumer below reads from it.
 */
export interface EquippedSnapshot {
  attrs: AttributeBlock;
  weapon: { dmgMin: number; dmgMax: number; speedSec: number };
}

export function equippedSnapshot(
  ctx: CombatStateCtx,
  owner: unknown,
): EquippedSnapshot {
  const attrs: AttributeBlock = {};
  let weapon: EquippedSnapshot['weapon'] | null = null;
  for (const row of ctx.db.playerEquipped.iter()) {
    if (!row.owner.isEqual(owner)) continue;
    const stats = ITEMS[row.itemId]?.gameStats;
    if (!stats) continue;
    for (const key of ATTRIBUTE_KEYS) {
      const v = stats[key];
      if (typeof v === 'number' && v !== 0) attrs[key] = (attrs[key] ?? 0) + v;
    }
    if (row.slot === 'mainHand') {
      weapon = {
        dmgMin: stats.weaponDmgMin ?? UNARMED_WEAPON.dmgMin,
        dmgMax: stats.weaponDmgMax ?? UNARMED_WEAPON.dmgMax,
        speedSec: stats.weaponSpeedSec ?? UNARMED_WEAPON.speedSec,
      };
    }
  }
  return { attrs, weapon: weapon ?? { ...UNARMED_WEAPON } };
}

/** Sum of every equipped item's attribute contributions. */
export function equippedAttributes(
  ctx: CombatStateCtx,
  owner: unknown,
): AttributeBlock {
  return equippedSnapshot(ctx, owner).attrs;
}

// ── abilityCooldowns: a compact JSON map on the player row ───────────────────
//
// `{abilityId: microsSinceEpoch}` for at most 22 abilities (~300 bytes worst
// case) on a row the client already subscribes to. A per-(player, ability)
// table would be one row per cast plus its own reaper for the same data.
// Micros-since-epoch is ~1.8e15, comfortably inside a float64's exact integer
// range (9.0e15), so round-tripping through JSON numbers is lossless — but the
// in-memory representation stays bigint because the resolver compares against
// `ctx.timestamp.microsSinceUnixEpoch`.

export function parseCooldowns(json: string): Record<string, bigint> {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    // A corrupt field must not brick every cast the player ever makes again.
    return {};
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, bigint> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = BigInt(Math.trunc(v));
  }
  return out;
}

/** Serialize, dropping entries that have already expired so the field cannot grow. */
export function serializeCooldowns(
  cooldowns: Record<string, bigint>,
  nowMicros: bigint,
): string {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(cooldowns)) {
    if (v > nowMicros) out[k] = Number(v);
  }
  return Object.keys(out).length === 0 ? '' : JSON.stringify(out);
}

/** `deriveStats(...).maxResource` from an already-taken snapshot. */
export function maxResourceFrom(
  attrs: AttributeBlock,
  classType: string,
  level: number,
): number {
  const classId = classIdOf(classType);
  if (!classId) return 0;
  return deriveStats(attrs, level, CLASS_KITS[classId]).maxResource;
}

/** `deriveStats(...).maxResource` for a player's kit, gear and level (own scan). */
export function resourceMaxFor(
  ctx: CombatStateCtx,
  owner: unknown,
  classType: string,
  level: number,
): number {
  return maxResourceFrom(equippedSnapshot(ctx, owner).attrs, classType, level);
}

// ── Resource regeneration (D94) ─────────────────────────────────
//
// M6 has no rage generation (rage is earned by taking and dealing hits, an M7
// tuning pass) and no five-second-rule mana mechanic. Without SOME regeneration
// every class runs dry after a handful of casts and the ability system is
// untestable, so all three resources refill at a flat fraction of max per
// second. This is the one number in M6 that is tuning rather than content.
//
// It is applied LAZILY, at cast time, from `player.lastRegenAt` — not by a
// sweep. A 1 Hz sweep would rescan `playerEquipped` per online player and write
// a row on the module's hottest PUBLIC table every second, forever, whether or
// not anyone is fighting; the lazy form is O(1) per cast and free while idle.
// The cost is that the stored `resource` column is a low-water mark between
// casts rather than a live value — the client renders the same formula.

/** D94: 5 % of `resourceMax` per second. Placeholder tuning; revisit with M7. */
export const RESOURCE_REGEN_FRACTION_PER_SEC = 0.05;

/**
 * `min(max, current + max * RATE * secondsSince(lastRegenAt))`.
 *
 * `lastRegenAt === 0n` (a row that predates the column, or one that has never
 * cast) yields a huge elapsed time and therefore a full pool, which is the
 * same answer `clientConnected` gives — deliberately, so the two agree.
 */
export function regeneratedResource(
  current: number,
  max: number,
  lastRegenAtMicros: bigint,
  nowMicros: bigint,
): number {
  if (max <= 0) return 0;
  if (lastRegenAtMicros <= 0n || nowMicros <= lastRegenAtMicros) {
    return Math.max(0, Math.min(max, lastRegenAtMicros <= 0n ? max : current));
  }
  const elapsedSec = Number(nowMicros - lastRegenAtMicros) / 1_000_000;
  return Math.max(0, Math.min(max, current + max * RESOURCE_REGEN_FRACTION_PER_SEC * elapsedSec));
}

/**
 * Assemble the caster. Returns null when `player.classType` is not one of the
 * 11 shipped kits — the caller turns that into an `unknownAbility`-shaped
 * rejection rather than throwing inside a reducer.
 */
export function buildCasterState(
  ctx: CombatStateCtx,
  player: any,
  level: number,
  snapshot: EquippedSnapshot = equippedSnapshot(ctx, player.identity),
  resource: number = player.resource,
): CasterState | null {
  const classId = classIdOf(player.classType);
  if (!classId) return null;
  return {
    level,
    classId,
    attrs: snapshot.attrs,
    resource,
    hp: player.hp,
    maxHp: player.maxHp,
    weapon: snapshot.weapon,
    cooldownsMicros: parseCooldowns(player.abilityCooldowns),
    lastGcdAtMicros: player.lastGcdAt,
  };
}

/** Assemble the target from a live `mob` row plus its content definition. */
export function buildTargetState(mob: any): TargetState {
  const def = MOBS[mob.mobType];
  return {
    level: def?.level ?? 1,
    hp: mob.hp,
    maxHp: mob.maxHp,
    armor: MOB_ARMOR,
  };
}
