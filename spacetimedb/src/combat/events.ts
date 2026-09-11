/**
 * combat/events.ts — the one writer of the `combatEvent` table (M6 §2.6).
 *
 * Every combat outcome AND every rejection reason is published as a row so the
 * client never has to infer damage from an `hp` delta. Two players hitting one
 * mob make hp deltas ambiguous, and miss/dodge do not move hp at all, so the
 * delta is not merely imprecise — it is unable to express the event.
 *
 * Rows are short-lived: `reapCombatEvents` deletes anything older than
 * COMBAT_EVENT_TTL_MICROS. The table is a transient notification channel that
 * happens to be a table because SpacetimeDB has no other push primitive.
 */

export type CombatEventCtx = { db: any };

/**
 * `kind` vocabulary. `rejected` is the only kind that carries a `reason`
 * (a `CastRejection` string from the canonical resolver); the rest leave it ''.
 */
export const COMBAT_EVENT_KINDS = [
  'hit',
  'crit',
  'miss',
  'dodge',
  'kill',
  'healed',
  'absorbed',
  'aura',
  'rejected',
  'tick',
] as const;

export type CombatEventKind = (typeof COMBAT_EVENT_KINDS)[number];

/** Rows older than this are deleted by `reapCombatEvents` (5 s reap cadence). */
export const COMBAT_EVENT_TTL_MICROS = 5_000_000n;

export function emitCombatEvent(
  ctx: CombatEventCtx,
  ev: {
    at: bigint;
    actor: unknown;
    abilityId: string;
    targetMobId: bigint;
    kind: CombatEventKind;
    amount?: number;
    reason?: string;
  },
): void {
  ctx.db.combatEvent.insert({
    id: 0n, // auto-inc replaces this
    at: ev.at,
    actor: ev.actor,
    abilityId: ev.abilityId,
    targetMobId: ev.targetMobId,
    kind: ev.kind,
    amount: Math.round(ev.amount ?? 0),
    reason: ev.reason ?? '',
  });
}

/**
 * Module-side logging.
 *
 * The SpacetimeDB TS host installs `globalThis.console` at load
 * (`spacetimedb/dist/server/index.mjs` — `globalThis.console = console2`), but
 * `tsconfig.json` runs with `"lib": ["ESNext"], "types": []`, so there is no
 * ambient `console` declaration to compile against. Declaring the one method
 * we use is honest about that, and keeps the log line out of every call site.
 */
declare const console: { log(...args: unknown[]): void };

export function logCombat(message: string): void {
  console.log(message);
}
