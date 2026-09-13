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
import type { AttributeBlock, AttributeKey } from '../content/types.js';

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
      // `appliedBy` (M9-6) is what lets a dot's killing blow be credited. A
      // mobAura row is the only aura with no owner column — it belongs to the
      // mob, not to the caster — so without this the scheduled `tickAuras`
      // had no player to name and a bleed-out dropped nothing. It is written
      // here, at the one place mob auras are created, so it cannot be missed.
      ctx.db.mobAura.insert({
        id: 0n, mobId: opts.targetMobId, appliedBy: opts.casterIdentity, ...common,
      });
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

// ─────────────────────────────────────────────────────────────────────────────
// M9-6 — CONSUMPTION
//
// Everything above PLACES auras and works out what a tick owes. The three
// helpers below are the other half: what a placed aura actually DOES to a
// cast, to a move, and to an incoming hit. They are pure over plain rows for
// the same reason `partitionAuraWork` is — the root vitest can read them, and
// `index.ts` cannot be imported outside a SpacetimeDB host.
//
// Every one of them takes `nowMicros` and ignores expired rows. Expiry is
// swept by `tickAuras` at 1 Hz, so a row can sit up to a second past its
// `expiresAt`; a consumer that trusted mere existence would grant a free
// extra second of every buff, stun and shield in the game.
// ─────────────────────────────────────────────────────────────────────────────

/** The minimum row shape every consumer below needs. */
interface AuraRowLike {
  effectKind: string;
  magnitude: number;
  expiresAt: bigint;
}

/** Aura kinds that contribute a stat delta (`AbilityEffect.stat`). */
export const BUFF_AURA_KINDS = ['selfBuff', 'buffTarget'] as const;

/** Aura kinds that restrict movement. */
export const CONTROL_AURA_KINDS = ['stun', 'root', 'slow'] as const;

const ATTRIBUTE_KEYS: readonly AttributeKey[] = [
  'STR', 'END', 'DEX', 'CON', 'INT', 'CHA', 'WIS', 'VIT',
];

const ATTRIBUTE_KEY_SET: ReadonlySet<string> = new Set(ATTRIBUTE_KEYS);

/**
 * What the live buff auras on one owner add up to.
 *
 * `stat` is `AttributeKey | 'armor' | 'attackPower'` (content/types.ts), so the
 * three families are kept apart rather than mashed into one number: only the
 * attribute family can be handed back to `deriveStats`.
 */
export interface AuraStatBonuses {
  /** Per-attribute deltas, ready to add to an `AttributeBlock`. */
  attrs: AttributeBlock;
  /** Flat armor. See `buffedAttributes` for why this is NOT folded in. */
  armor: number;
  /** Flat attack power. Folded into STR by `buffedAttributes`. */
  attackPower: number;
}

export function auraStatBonuses<T extends AuraRowLike & { stat: string }>(
  rows: T[],
  nowMicros: bigint,
): AuraStatBonuses {
  const out: AuraStatBonuses = { attrs: {}, armor: 0, attackPower: 0 };
  for (const row of rows) {
    if (row.effectKind !== 'selfBuff' && row.effectKind !== 'buffTarget') continue;
    if (nowMicros >= row.expiresAt) continue;
    if (row.stat === 'armor') out.armor += row.magnitude;
    else if (row.stat === 'attackPower') out.attackPower += row.magnitude;
    else if (ATTRIBUTE_KEY_SET.has(row.stat)) {
      const key = row.stat as AttributeKey;
      out.attrs[key] = (out.attrs[key] ?? 0) + row.magnitude;
    }
    // Any other `stat` string is content that names a stat this build has no
    // mapping for. Dropping it is deliberate: a silent no-op beats guessing.
  }
  return out;
}

/**
 * Fold buff auras into the attribute block `deriveStats` will read, so
 * `resolveCast` sees a buffed caster without `combat.ts` learning about auras
 * (D121 keeps that file a pure function of attributes — the root vitest suite
 * depends on it).
 *
 * The fold is exact, not an approximation, because of how `deriveStats` maps:
 *
 *   attackPower = round(STR + DEX)   and STR appears in NO other derived stat,
 *   so `+N attackPower` and `+N STR` produce identical DerivedStats. That is
 *   why `attackPower` may be folded and why it is folded into STR rather than
 *   DEX — DEX also drives `critChance`, so folding there would hand out crit.
 *
 *   baseArmor = CON * 2, but CON ALSO drives maxHp, so folding `armor / 2`
 *   into CON would silently inflate the caster's max HP. `armor` is therefore
 *   returned separately and left to the caller. As of M9-6 the module applies
 *   no armor mitigation to a player at all (mob melee in `applyMobHit` deals
 *   raw damage), so there is nothing to apply it to yet — see the PR note.
 */
export function buffedAttributes(
  base: AttributeBlock,
  bonuses: AuraStatBonuses,
): AttributeBlock {
  const out: AttributeBlock = { ...base };
  for (const key of ATTRIBUTE_KEYS) {
    const delta = bonuses.attrs[key] ?? 0;
    if (delta !== 0) out[key] = (out[key] ?? 0) + delta;
  }
  if (bonuses.attackPower !== 0) {
    out.STR = (out.STR ?? 0) + bonuses.attackPower;
  }
  return out;
}

/** What the live control auras on one player do to `movePlayer`. */
export interface MoveRestriction {
  /** A stun or root is live — the move is refused outright. */
  blocked: boolean;
  /** Multiplier for the speed ceiling; 1 when unslowed, `slowMultiplier(pct)` otherwise. */
  speedMultiplier: number;
}

/**
 * Read stun / root / slow off a player's auras.
 *
 * Slows do NOT stack: the strongest live slow wins. Multiplying two 50 % slows
 * into a 25 % multiplier is how a pair of ordinary debuffs becomes a
 * hard root, which is a balance decision nobody made.
 *
 * `slowMultiplier` is the ONLY conversion from the stored PERCENT to a
 * multiplier — see its own comment; `magnitude` is 0-90, not 0-1.
 */
export function movementRestriction<T extends AuraRowLike>(
  rows: T[],
  nowMicros: bigint,
): MoveRestriction {
  let blocked = false;
  let speedMultiplier = 1;
  for (const row of rows) {
    if (nowMicros >= row.expiresAt) continue;
    if (row.effectKind === 'stun' || row.effectKind === 'root') {
      blocked = true;
    } else if (row.effectKind === 'slow') {
      const m = slowMultiplier(row.magnitude);
      if (m < speedMultiplier) speedMultiplier = m;
    }
  }
  return { blocked, speedMultiplier };
}

/** The write plan `consumeAbsorb` hands back; the caller owns the rows. */
export interface AbsorbOutcome<T> {
  /** HP the shields ate, rounded to a whole point. */
  absorbed: number;
  /** Damage still owed to the victim's hp, rounded to a whole point. */
  remaining: number;
  /** `abilityId` of the first pool that ate damage; '' when nothing absorbed. */
  absorbedBy: string;
  /** Rows whose pool shrank but survived, paired with their new magnitude. */
  drained: { row: T; magnitude: number }[];
  /** Rows whose pool hit zero and must be deleted. */
  spent: T[];
}

/**
 * Spend `damage` against the live `absorb` pools in `rows`.
 *
 * Pools are consumed soonest-expiring first, so a shield about to lapse is
 * used before one with time left rather than being wasted.
 *
 * A pool that reaches zero is deleted, not left as a 0 HP row: a spent shield
 * still renders as a shield on the client and still costs a scan on every
 * subsequent hit until `tickAuras` happens to expire it. "Zero" is really
 * "under 1 HP" — `magnitude` is an f32 column, so an exactly-drained pool
 * lands on a sliver like 1e-6 rather than on 0, and a sliver shield is a row
 * that never dies.
 *
 * Pure: it writes nothing. The caller applies `drained` / `spent` and emits
 * the `'absorbed'` event, because only the caller has a `ctx`.
 */
export function consumeAbsorb<T extends AuraRowLike & { abilityId: string }>(
  rows: T[],
  damage: number,
  nowMicros: bigint,
): AbsorbOutcome<T> {
  const out: AbsorbOutcome<T> = {
    absorbed: 0,
    remaining: Math.max(0, damage),
    absorbedBy: '',
    drained: [],
    spent: [],
  };
  if (out.remaining <= 0) return out;

  const pools = rows
    .filter((r) => r.effectKind === 'absorb' && nowMicros < r.expiresAt && r.magnitude > 0)
    .sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : a.expiresAt > b.expiresAt ? 1 : 0));

  for (const pool of pools) {
    if (out.remaining <= 0) break;
    const eaten = Math.min(pool.magnitude, out.remaining);
    out.absorbed += eaten;
    out.remaining -= eaten;
    if (out.absorbedBy === '') out.absorbedBy = pool.abilityId;
    const left = pool.magnitude - eaten;
    if (left < 1) out.spent.push(pool);
    else out.drained.push({ row: pool, magnitude: left });
  }

  out.absorbed = Math.round(out.absorbed);
  out.remaining = Math.round(out.remaining);
  return out;
}
