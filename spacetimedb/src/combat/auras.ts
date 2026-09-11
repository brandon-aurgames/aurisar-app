/**
 * combat/auras.ts — timed effects on players and mobs (M6 §2.4).
 *
 * The resolver turns `dot / hot / absorb / selfBuff / buffTarget / stun / root
 * / slow` into `ResolvedEffect{kind:'aura'}` deltas; this file persists them
 * and works out what each 1 Hz tick owes. The reducer bodies stay in
 * `index.ts` because applying a dot's killing blow needs the shared kill path
 * (and therefore `ScheduleAt` and `creditKillToQuests`), and neither belongs
 * in a helper that the root vitest reads.
 *
 * MAGNITUDE UNITS — the one trap here:
 *   • dot / hot        `magnitude` is the PER-TICK amount (the resolver already
 *                      divided the authored total by the tick count).
 *   • absorb           a damage pool in HP.
 *   • selfBuff/buffTarget  a flat amount added to `stat`.
 *   • slow             a PERCENT in 0..90 (content authors `pct: 50`; the
 *                      resolver clamps rank scaling at 90). It is NOT a 0..1
 *                      fraction — multiplying a speed by it directly would
 *                      make a "50% slow" a 50x speed-up.
 *   • stun / root      no magnitude (0); duration is the whole effect.
 */

import type { ResolvedEffect } from '../content/formulas/abilityResolve.js';

export type AuraCtx = { db: any };

/** `tickAuras` cadence — 1 Hz (M6 §2.4). */
export const AURA_TICK_MICROS = 1_000_000n;

/** Aura kinds that deal or restore HP on each tick. */
export const TICKING_AURA_KINDS = ['dot', 'hot'] as const;

function microsFromSec(sec: number): bigint {
  return BigInt(Math.max(0, Math.round(sec * 1_000_000)));
}

/**
 * Convert a `slow` aura's PERCENT magnitude into a movement multiplier.
 * `slowMultiplier(50) === 0.5`. Exported so any future consumer (movement
 * enforcement, client prediction) cannot re-derive it wrongly.
 */
export function slowMultiplier(percent: number): number {
  const clamped = Math.min(90, Math.max(0, percent));
  return 1 - clamped / 100;
}

/**
 * Persist the aura effects of one resolved cast.
 *
 * `onSelf` auras land on the caster (`playerAura`), the rest on the target mob
 * (`mobAura`). A self-cast with no mob target simply has no non-self auras to
 * place — M6 has no player-vs-player targeting.
 *
 * Re-casting an ability refreshes rather than stacks: the existing row for the
 * same (owner, abilityId, effectKind) is replaced. Stacking is a tuning
 * decision M7 can make; silently doubling a dot is not.
 */
export function applyResolvedAuras(
  ctx: AuraCtx,
  effects: ResolvedEffect[],
  opts: {
    abilityId: string;
    casterIdentity: unknown;
    targetMobId: bigint;
    nowMicros: bigint;
  },
): number {
  let placed = 0;
  for (const effect of effects) {
    if (effect.kind !== 'aura') continue;
    const expiresAt = opts.nowMicros + microsFromSec(effect.durationSec);
    const tickSec = effect.tickSec > 0 ? effect.tickSec : 0;
    const nextTickAt =
      tickSec > 0 ? opts.nowMicros + microsFromSec(tickSec) : 0n;
    const common = {
      abilityId: opts.abilityId,
      effectKind: effect.effectKind,
      stat: effect.stat ?? '',
      magnitude: effect.magnitude,
      expiresAt,
      nextTickAt,
      tickSec,
    };

    if (effect.onSelf) {
      const existing = findPlayerAura(
        ctx, opts.casterIdentity, opts.abilityId, effect.effectKind,
      );
      if (existing) ctx.db.playerAura.id.delete(existing.id);
      ctx.db.playerAura.insert({ id: 0n, owner: opts.casterIdentity, ...common });
      placed++;
    } else if (opts.targetMobId > 0n) {
      const existing = findMobAura(
        ctx, opts.targetMobId, opts.abilityId, effect.effectKind,
      );
      if (existing) ctx.db.mobAura.id.delete(existing.id);
      ctx.db.mobAura.insert({ id: 0n, mobId: opts.targetMobId, ...common });
      placed++;
    }
  }
  return placed;
}

function findPlayerAura(
  ctx: AuraCtx, owner: unknown, abilityId: string, effectKind: string,
): any | null {
  for (const row of ctx.db.playerAura.iter()) {
    if (!row.owner.isEqual(owner)) continue;
    if (row.abilityId !== abilityId || row.effectKind !== effectKind) continue;
    return row;
  }
  return null;
}

function findMobAura(
  ctx: AuraCtx, mobId: bigint, abilityId: string, effectKind: string,
): any | null {
  for (const row of ctx.db.mobAura.iter()) {
    if (row.mobId !== mobId) continue;
    if (row.abilityId !== abilityId || row.effectKind !== effectKind) continue;
    return row;
  }
  return null;
}

/**
 * Split a snapshot of aura rows into the ones that have expired and the ones
 * owing a tick. Pure over plain rows so the ordering rule — expiry wins, a
 * tick due in the same microsecond as expiry does not fire — is testable
 * without a database.
 */
export function partitionAuraWork<T extends {
  id: bigint; expiresAt: bigint; nextTickAt: bigint; tickSec: number;
}>(rows: T[], nowMicros: bigint): { expired: T[]; ticking: T[] } {
  const expired: T[] = [];
  const ticking: T[] = [];
  for (const row of rows) {
    if (nowMicros >= row.expiresAt) {
      expired.push(row);
      continue;
    }
    if (row.tickSec > 0 && row.nextTickAt > 0n && nowMicros >= row.nextTickAt) {
      ticking.push(row);
    }
  }
  return { expired, ticking };
}

/**
 * Advance a ticking aura's `nextTickAt`, skipping any ticks a stalled
 * scheduler slept through rather than firing a burst of back-payments.
 */
export function advanceTick(row: { nextTickAt: bigint; tickSec: number }, nowMicros: bigint): bigint {
  const step = microsFromSec(row.tickSec);
  if (step <= 0n) return row.nextTickAt;
  let next = row.nextTickAt + step;
  while (next <= nowMicros) next += step;
  return next;
}
