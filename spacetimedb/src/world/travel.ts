/**
 * world/travel.ts — gate-based zone-to-zone travel (D155).
 *
 * Zone 2+ are offset regions on the shared STDB px plane, reached through a
 * gate reducer — not a contiguous terrain extension and not a dungeon
 * instance (D155). `resolveGateTravel` is the content-resolution + proximity
 * + level-gate logic behind `travelToZone` in index.ts, modeled on how
 * `enterDungeon` already proves this shape of transition end to end:
 *
 *   1. the named gate must exist in the CURRENT zone's manifest entry
 *      (`player.zoneId`, per D157 — the content ZoneDef.id);
 *   2. the caller must be within range of that gate's content position,
 *      converted to px the same way seedWorld and every other proximity
 *      gate does (contentPosToPx — the one copy of that arithmetic);
 *   3. the destination zone (`gate.toZoneId`) and destination gate
 *      (`gate.toGateId`) must both actually exist in the manifest — should
 *      always hold once `validateContent`'s back-link check has run, but a
 *      reducer must not trust content shape blindly at runtime either. This
 *      is the live, exercised-today case: zone 1's own `z1_north_pass` names
 *      `toZoneId: 2`, which does not ship until a later milestone, so this
 *      is the path that currently fires;
 *   4. the caller's own level must clear the destination zone's
 *      `levelBand[0]` floor — the same shape of gate `enterDungeon` already
 *      applies via `dungeon.minLevel` (and `acceptQuest` via
 *      `quest.minLevel`), just keyed off the zone's band instead of a
 *      dedicated field. Only the floor is enforced, not the ceiling: a
 *      higher-level character must still be able to walk back into an
 *      earlier zone, same as `minLevel` gates elsewhere never cap from above.
 *
 * `player` is the caller's own already-validated stored position — never a
 * client-claimed x/y — so unlike `buildCampfire` (PR #363 review, finding M1)
 * there is no non-finite-input path into the range check here for a spoofed
 * claim to bypass; the plain `<= RANGE_SQ` form used elsewhere for
 * server-owned positions (playerNearChest, playerNearNpc) applies as-is.
 *
 * Pure and free of any `ctx`/`spacetimedb/server` dependency by design, so it
 * is directly unit-testable — see spacetimedb/src/__tests__/
 * mobInsertColumns.test.js's own comment for why anything that imports
 * index.ts (and so `spacetimedb/server`) cannot safely be executed from this
 * workspace's root vitest run: the root install and spacetimedb/ pin two
 * different versions of that package on purpose.
 */
import { ZONES_BY_ID } from '../content/index.js';
import { contentPosToPx } from './zones.js';

/** Mirrors PX_PER_M in src/features/world/worldSpace.js. */
const PX_PER_M = 32;

/**
 * Tolerance for "standing at the gate" — matches DUNGEON_GATE_RANGE_PX's 6 m
 * (dungeon/helpers.ts). A separate named constant rather than a shared import
 * because a zone gate and a dungeon entrance are different content concepts
 * that happen to want the same tolerance today; nothing ties them together.
 */
export const ZONE_GATE_RANGE_PX = 6 * PX_PER_M;
const ZONE_GATE_RANGE_SQ = ZONE_GATE_RANGE_PX * ZONE_GATE_RANGE_PX;

/** Why a travel claim was refused — named so tests can assert on the exact guard. */
export type GateTravelRejection =
  | 'no-such-gate'
  | 'out-of-range'
  | 'bad-destination'
  | 'level-too-low';

export interface GateTravelSuccess {
  ok: true;
  /** Destination content ZoneDef.id. */
  zoneId: number;
  /** Destination position in STDB px. */
  x: number;
  y: number;
}

export interface GateTravelFailure {
  ok: false;
  /** Which guard rejected the claim — named so tests can assert on it. */
  reason: GateTravelRejection;
}

/** Discriminated on `ok` so a caller's `if (!outcome.ok) return;` narrows the rest for free. */
export type GateTravelOutcome = GateTravelSuccess | GateTravelFailure;

/**
 * Resolve a `travelToZone(gateId)` claim. Caller (index.ts) is responsible
 * for the player-existence and alive/stun/root guards that gate every other
 * teleport-style reducer (enterDungeon, movePlayer) — this function only
 * covers the content-shape + proximity + level questions, so it has no `ctx`
 * and needs no player row beyond the position/level already read from one.
 */
export function resolveGateTravel(
  player: { x: number; y: number },
  currentZoneId: number,
  gateId: string,
  playerLevel: number,
): GateTravelOutcome {
  const zone = ZONES_BY_ID[currentZoneId];
  const gate = zone?.gates.find((g) => g.id === gateId);
  if (!zone || !gate) return { ok: false, reason: 'no-such-gate' };

  const gatePx = contentPosToPx(zone.id, gate.pos);
  const dx = player.x - gatePx.x;
  const dy = player.y - gatePx.y;
  if (dx * dx + dy * dy > ZONE_GATE_RANGE_SQ) {
    return { ok: false, reason: 'out-of-range' };
  }

  const destZone = ZONES_BY_ID[gate.toZoneId];
  const destGate = destZone?.gates.find((g) => g.id === gate.toGateId);
  if (!destZone || !destGate) return { ok: false, reason: 'bad-destination' };

  if (playerLevel < destZone.levelBand[0]) {
    return { ok: false, reason: 'level-too-low' };
  }

  const destPx = contentPosToPx(destZone.id, destGate.pos);
  return { ok: true, zoneId: destZone.id, x: destPx.x, y: destPx.y };
}
