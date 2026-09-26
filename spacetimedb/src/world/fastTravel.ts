/**
 * world/fastTravel.ts — waypoint discovery and fast travel (M12-6, D189).
 *
 * The pure half of `discoverWaypoint` / `fastTravel` in index.ts, plus the
 * waypoint proximity check that `reachWaypoint` used to inline. Both reducers
 * read the caller's rows (player, auras, progress, playerWaypoint,
 * playerTravelState) and hand the plain values here; everything that decides
 * accept-or-reject lives in this file so every guard is unit-testable from the
 * root vitest run without a `spacetimedb/server` runtime — the same reason
 * world/travel.ts keeps `resolveGateTravel` out of index.ts (see that file's
 * header and __tests__/mobInsertColumns.test.js).
 *
 * Server-authoritative (D189): the client never names a destination position,
 * only a waypoint id. Discovery requires standing at the waypoint in its own
 * zone; travel requires a discovered waypoint and writes the destination row
 * exactly as `travelToZone` does.
 *
 * Known limitation, deliberate for this pass: "in combat" means *the player
 * attacked recently* — `player.lastAttackAt`, which both `castAbility` and
 * `castAbilityById` stamp — within FAST_TRAVEL_COMBAT_LOCKOUT_MICROS. A player
 * being hit by a mob without swinging back is not detected here; there is no
 * per-player "last damaged at" column, and adding one would be a column on the
 * live `player` table (D189: new tables only).
 */
import { WAYPOINTS, ZONES_BY_ID } from '../content/index.js';
import type { WaypointDef } from '../content/types.js';
import { contentPosToPx } from './zones.js';

/** Mirrors PX_PER_M in src/features/world/worldSpace.js. */
const PX_PER_M = 32;

/**
 * Metres of slack added to a waypoint's `radiusM` for interpolation slop —
 * the value `reachWaypoint` has always used.
 */
export const WAYPOINT_RANGE_TOLERANCE_M = 2;

/** No fast travel within 10 s of the caller's last melee swing / cast. */
export const FAST_TRAVEL_COMBAT_LOCKOUT_MICROS = 10_000_000n;

/** 60 s between two accepted fast travels by the same identity. */
export const FAST_TRAVEL_COOLDOWN_MICROS = 60_000_000n;

/**
 * Is `player` (stored STDB px, never a client claim) within the waypoint's
 * radius plus WAYPOINT_RANGE_TOLERANCE_M? Extracted verbatim from
 * `reachWaypoint` so quest 'find' objectives and waypoint discovery share one
 * definition of "standing at a waypoint". Inclusive on the edge, as before.
 */
export function playerWithinWaypointRange(
  player: { x: number; y: number },
  wp: Pick<WaypointDef, 'zoneId' | 'pos' | 'radiusM'>,
): boolean {
  const px = contentPosToPx(wp.zoneId, wp.pos);
  const rangePx = (wp.radiusM + WAYPOINT_RANGE_TOLERANCE_M) * PX_PER_M;
  const dx = player.x - px.x;
  const dy = player.y - px.y;
  return dx * dx + dy * dy <= rangePx * rangePx;
}

/** The subset of a `player` row these guards read. */
export interface FastTravelPlayer {
  x: number;
  y: number;
  zoneId: number;
  hp: number;
  deadUntil: bigint;
  dungeonInstanceId: bigint;
  lastAttackAt: bigint;
}

function isDead(player: FastTravelPlayer, nowMicros: bigint): boolean {
  return player.hp <= 0 || player.deadUntil > nowMicros;
}

// ── discoverWaypoint ────────────────────────────────────────────────────────

export type DiscoverRejection =
  | 'no-such-waypoint'
  | 'dead'
  | 'indoors'
  | 'wrong-zone'
  | 'out-of-range';

export type DiscoverOutcome =
  | { ok: true; waypoint: WaypointDef }
  | { ok: false; reason: DiscoverRejection };

/**
 * Resolve a `discoverWaypoint(waypointId)` claim. Idempotency (a second
 * discovery inserts nothing) is the caller's job, since it needs the table.
 */
export function resolveDiscoverWaypoint(
  player: FastTravelPlayer,
  waypointId: string,
  nowMicros: bigint,
): DiscoverOutcome {
  const wp = WAYPOINTS[waypointId];
  if (!wp) return { ok: false, reason: 'no-such-waypoint' };
  if (isDead(player, nowMicros)) return { ok: false, reason: 'dead' };
  if (player.dungeonInstanceId !== 0n) return { ok: false, reason: 'indoors' };
  if (player.zoneId !== wp.zoneId) return { ok: false, reason: 'wrong-zone' };
  if (!playerWithinWaypointRange(player, wp)) return { ok: false, reason: 'out-of-range' };
  return { ok: true, waypoint: wp };
}

// ── fastTravel ──────────────────────────────────────────────────────────────

export type FastTravelRejection =
  | 'no-such-waypoint'
  | 'dead'
  | 'indoors'
  | 'movement-restricted'
  | 'recent-attack'
  | 'undiscovered'
  | 'bad-destination'
  | 'level-too-low'
  | 'cooldown';

export interface FastTravelInput {
  player: FastTravelPlayer;
  waypointId: string;
  nowMicros: bigint;
  /** `movementRestriction(...).blocked` for the caller — stun/root, as movePlayer/travelToZone. */
  movementBlocked: boolean;
  /** Does the caller own a `playerWaypoint` row for this waypoint? */
  discovered: boolean;
  /** The caller's world level (`getPlayerLevel`). */
  playerLevel: number;
  /** `playerTravelState.lastFastTravelAt`, or 0n when the caller has no row yet. */
  lastFastTravelAt: bigint;
}

export type FastTravelOutcome =
  | { ok: true; waypoint: WaypointDef; x: number; y: number }
  | { ok: false; reason: FastTravelRejection };

/**
 * Resolve a `fastTravel(waypointId)` claim. On success returns the destination
 * in STDB px (`contentPosToPx(wp.zoneId, wp.pos)`); the caller re-derives the
 * row's `zoneId` from it with `resolveZone`, exactly as `travelToZone` does.
 *
 * The destination's `levelBand[0]` floor is the rule `resolveGateTravel`
 * (world/travel.ts) applies to gate travel: floor only, never the ceiling, so
 * a higher-level character can always go back to an earlier zone.
 */
export function resolveFastTravel(input: FastTravelInput): FastTravelOutcome {
  const { player, waypointId, nowMicros } = input;

  const wp = WAYPOINTS[waypointId];
  if (!wp) return { ok: false, reason: 'no-such-waypoint' };
  if (isDead(player, nowMicros)) return { ok: false, reason: 'dead' };
  if (player.dungeonInstanceId !== 0n) return { ok: false, reason: 'indoors' };
  if (input.movementBlocked) return { ok: false, reason: 'movement-restricted' };
  // See the header: "in combat" = attacked recently, nothing more.
  if (
    player.lastAttackAt > 0n &&
    nowMicros - player.lastAttackAt < FAST_TRAVEL_COMBAT_LOCKOUT_MICROS
  ) {
    return { ok: false, reason: 'recent-attack' };
  }
  if (!input.discovered) return { ok: false, reason: 'undiscovered' };

  const destZone = ZONES_BY_ID[wp.zoneId];
  if (!destZone) return { ok: false, reason: 'bad-destination' };
  if (input.playerLevel < destZone.levelBand[0]) return { ok: false, reason: 'level-too-low' };

  if (
    input.lastFastTravelAt > 0n &&
    nowMicros - input.lastFastTravelAt < FAST_TRAVEL_COOLDOWN_MICROS
  ) {
    return { ok: false, reason: 'cooldown' };
  }

  const px = contentPosToPx(wp.zoneId, wp.pos);
  return { ok: true, waypoint: wp, x: px.x, y: px.y };
}

// ── table plumbing ──────────────────────────────────────────────────────────
//
// Narrow structural views of the two M12-6 tables, so the insert-once and
// cooldown-stamp logic is testable against an in-memory fake. index.ts passes
// `ctx.db.playerWaypoint` / `ctx.db.playerTravelState` straight in.

/** `ctx.db.playerWaypoint`, as far as these helpers use it. */
export interface PlayerWaypointTableLike {
  owner: { filter(owner: any): Iterable<{ waypointId: string }> };
  insert(row: { id: bigint; owner: any; waypointId: string; discoveredAt: bigint }): unknown;
}

/** `ctx.db.playerTravelState`, as far as these helpers use it. */
export interface PlayerTravelStateTableLike {
  identity: {
    find(identity: any): { identity: any; lastFastTravelAt: bigint } | null | undefined;
    update(row: { identity: any; lastFastTravelAt: bigint }): unknown;
  };
  insert(row: { identity: any; lastFastTravelAt: bigint }): unknown;
}

/** Does `owner` already have a `playerWaypoint` row for `waypointId`? */
export function hasDiscoveredWaypoint(
  table: PlayerWaypointTableLike,
  owner: any,
  waypointId: string,
): boolean {
  for (const row of table.owner.filter(owner)) {
    if (row.waypointId === waypointId) return true;
  }
  return false;
}

/**
 * Insert the discovery row unless one exists. Returns whether a row was
 * inserted, so a repeat `discoverWaypoint` is a no-op (idempotent).
 */
export function recordWaypointDiscovery(
  table: PlayerWaypointTableLike,
  owner: any,
  waypointId: string,
  nowMicros: bigint,
): boolean {
  if (hasDiscoveredWaypoint(table, owner, waypointId)) return false;
  table.insert({ id: 0n, owner, waypointId, discoveredAt: nowMicros });
  return true;
}

/** `playerTravelState.lastFastTravelAt` for `identity`, 0n when it has no row. */
export function lastFastTravelAtFor(table: PlayerTravelStateTableLike, identity: any): bigint {
  return table.identity.find(identity)?.lastFastTravelAt ?? 0n;
}

/** Upsert `identity`'s cooldown anchor to `nowMicros` after an accepted fast travel. */
export function stampFastTravel(
  table: PlayerTravelStateTableLike,
  identity: any,
  nowMicros: bigint,
): void {
  const existing = table.identity.find(identity);
  if (existing) table.identity.update({ ...existing, lastFastTravelAt: nowMicros });
  else table.insert({ identity, lastFastTravelAt: nowMicros });
}
