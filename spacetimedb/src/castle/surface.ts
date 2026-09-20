/**
 * Castle Ashwood's interior nav, as a binding of the shared engine.
 *
 * The level-aware scan, wall-slide and D92 recovery that used to live here —
 * closed over CASTLE_NAV_META / CASTLE_LEVELS / CASTLE_STAIRS at module
 * scope — now live in `dungeon/interiorNav.ts`, parameterized by a per-dungeon
 * descriptor (R21). This file is what makes that move invisible to every
 * existing caller: the exported names, signatures and results are unchanged,
 * and `CASTLE_INTERIOR_NAV` below is the descriptor the whole file is bound
 * to. Zone 1's origin offset is (0, 0), so every path through here reproduces
 * the retired module's arithmetic exactly.
 *
 * Mirrors castleNavSurface.js on the client side.
 */

import {
  CASTLE_NAV_META,
  CASTLE_NAV_BITMAPS_B64,
  CASTLE_LEVELS,
  CASTLE_STAIRS,
  CASTLE_STEP_UP,
  CASTLE_STEP_DOWN,
} from './navGrids.js';
import {
  INTERIOR_RECOVERY_TOLERANCE_M,
  interiorMoveAllowed,
  interiorRecoverSurface,
  interiorResolveMove,
  interiorSurfaceAt,
  isInInterior,
  makeInteriorNav,
  scanInteriorSurface,
  type DungeonInteriorNav,
  type InteriorGridAccessor,
  type Surface,
} from '../dungeon/interiorNav.js';

export { pxToWorldM, worldMToPx } from '../dungeon/interiorNav.js';
export type { Surface };
export type CastleGridAccessor = InteriorGridAccessor;
export const CASTLE_RECOVERY_TOLERANCE_M = INTERIOR_RECOVERY_TOLERANCE_M;

/**
 * Castle Ashwood's own interior descriptor.
 *
 * `zoneId: 1` is stated here rather than read out of CASTLE_NAV_META because
 * the castle emitter predates multi-zone content and emits no zoneId field
 * (the Barrowdeep's does). It is pinned equal to the DungeonDef's own
 * `entrance.zoneId` by dungeonInteriorNav.test.ts, so it cannot drift from the
 * content package silently.
 *
 * `entryLevelIndex: 1` is CASTLE_LEVELS' "ground" storey (y = 11) — the one
 * the interior spawn point stands on. Pinned against an actual scan of the
 * committed bitmaps at CASTLE_ASHWOOD_ENTRY.spawnLocal by the same test.
 */
export const CASTLE_INTERIOR_NAV: DungeonInteriorNav = makeInteriorNav({
  dungeonId: 'castle_ashwood',
  zoneId: 1,
  meta: CASTLE_NAV_META,
  bitmapsB64: CASTLE_NAV_BITMAPS_B64,
  levels: CASTLE_LEVELS,
  stairs: CASTLE_STAIRS,
  stepUp: CASTLE_STEP_UP,
  stepDown: CASTLE_STEP_DOWN,
  entryLevelIndex: 1,
});

/** Shared pure scan; the accessor supplies the emitted nav cell's surface tag. */
export function scanCastleInteriorSurface(
  wx: number, wz: number, minY: number, maxY: number, readCell: CastleGridAccessor,
): Surface | null {
  return scanInteriorSurface(CASTLE_INTERIOR_NAV, wx, wz, minY, maxY, readCell);
}

/** See interiorRecoverSurface — the D92 recovery window, bound to Ashwood's grids. */
export function castleInteriorRecoverSurface(
  wx: number, wz: number, claimedY: number,
  readCell: CastleGridAccessor = CASTLE_INTERIOR_NAV.readCell,
): Surface | null {
  return interiorRecoverSurface(CASTLE_INTERIOR_NAV, wx, wz, claimedY, readCell);
}

export function isInCastleInterior(worldXM: number, worldZM: number): boolean {
  return isInInterior(CASTLE_INTERIOR_NAV, worldXM, worldZM);
}

/** null = outside castle; otherwise surface reachable at currentY. */
export function castleInteriorSurfaceAt(
  worldXM: number,
  worldZM: number,
  currentY: number,
): Surface | null {
  return interiorSurfaceAt(CASTLE_INTERIOR_NAV, worldXM, worldZM, currentY);
}

/** Wall-slide one interior step — mirrors castleNav.resolveMove / castleNavSurface.js. */
export function castleInteriorResolveMove(
  prevXM: number,
  prevZM: number,
  nextXM: number,
  nextZM: number,
  currentY: number,
): { x: number; z: number; floorYM: number; surface: Surface | null } {
  return interiorResolveMove(CASTLE_INTERIOR_NAV, prevXM, prevZM, nextXM, nextZM, currentY);
}

/**
 * Two interior floors are "the same" when they are within one step-up of each
 * other. Still a single shared tolerance rather than a per-dungeon one: its
 * callers (melee range, ability targeting, mob target selection) hold a mob row
 * and a player row, not a dungeon descriptor, and every registered dungeon
 * declares the same 0.55 m step — pinned across the whole table by
 * dungeonInteriorNav.test.ts, so a dungeon that ever disagrees fails loudly
 * instead of being silently measured against Ashwood's number.
 */
export function sameInteriorFloor(a: number, b: number): boolean {
  return Math.abs(a - b) <= CASTLE_STEP_UP;
}

/** null = skip validation; false = blocked; true = allowed. */
export function castleInteriorMoveAllowed(
  worldXM: number,
  worldZM: number,
  currentY: number,
): boolean | null {
  return interiorMoveAllowed(CASTLE_INTERIOR_NAV, worldXM, worldZM, currentY);
}
