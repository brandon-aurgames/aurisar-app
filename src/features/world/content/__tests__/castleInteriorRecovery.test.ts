import { describe, expect, it } from 'vitest';
import {
  castleInteriorRecoverSurface, castleInteriorSurfaceAt, scanCastleInteriorSurface,
  CASTLE_RECOVERY_TOLERANCE_M, type CastleGridAccessor,
} from '../../../../../spacetimedb/src/castle/surface';
import {
  CASTLE_NAV_META, CASTLE_LEVELS, CASTLE_STAIRS, CASTLE_STEP_UP, CASTLE_STEP_DOWN,
} from '../../../../../spacetimedb/src/castle/navGrids';

const { anchor, bounds, navCellM, cols } = CASTLE_NAV_META;
const flatCell: CastleGridAccessor = (level) => level === 2 ? 1 : 0;

describe('castleInteriorRecoverSurface', () => {
  it('RecoversARealClaimedFloorAfterTheStoredFloorRejectsIt', () => {
    expect(scanCastleInteriorSurface(anchor.x, anchor.z, 11 - CASTLE_STEP_DOWN, 11 + CASTLE_STEP_UP, flatCell)).toBeNull();
    expect(castleInteriorRecoverSurface(anchor.x, anchor.z, 22, flatCell)).toEqual({ y: 22, level: 2 });
  });

  it('AcceptsAQuarterMeterAboveAndStepDownBelowTheClaimedFloor', () => {
    expect(CASTLE_RECOVERY_TOLERANCE_M).toBe(0.25);
    // The claimed floor may sit up to STEP_DOWN above the real surface (airborne on a descent) ...
    for (const offset of [-0.25, 0, 0.25, 0.55, 1.4]) {
      expect(castleInteriorRecoverSurface(anchor.x, anchor.z, 22 + offset, flatCell)).toEqual({ y: 22, level: 2 });
    }
    // ... but never more than the quarter-metre tolerance below it (no floor-through), nor past STEP_DOWN above.
    for (const offset of [-0.250001, -0.55, -1.4, 1.400001]) {
      expect(castleInteriorRecoverSurface(anchor.x, anchor.z, 22 + offset, flatCell)).toBeNull();
    }
  });

  it('RejectsBlockedCellsAndFloorsAbsentFromTheCell', () => {
    expect(castleInteriorRecoverSurface(anchor.x, anchor.z, 22, () => 0)).toBeNull();
    expect(castleInteriorRecoverSurface(anchor.x, anchor.z, 31.6, flatCell)).toBeNull();
    // A flat surface elsewhere in the same grid must not make this blocked cell valid.
    const targetIndex = Math.floor(-bounds.z0 / navCellM) * cols + Math.floor(-bounds.x0 / navCellM);
    const neighborOnly: CastleGridAccessor = (level, index) => level === 2 && index === targetIndex + 1 ? 1 : 0;
    expect(castleInteriorRecoverSurface(anchor.x, anchor.z, 22, neighborOnly)).toBeNull();
    expect(castleInteriorRecoverSurface(anchor.x + navCellM, anchor.z, 22, neighborOnly)).toEqual({ y: 22, level: 2 });
  });

  it('RejectsOutOfBoundsAndNonFiniteClaimsBeforeReadingTheGrid', () => {
    const unreadable: CastleGridAccessor = () => { throw new Error('must not scan'); };
    for (const [x, z, y] of [
      [anchor.x + bounds.x1, anchor.z, 22], [anchor.x + bounds.x0 - 0.01, anchor.z, 22],
      [anchor.x, anchor.z + bounds.z1, 22], [anchor.x, anchor.z + bounds.z0 - 0.01, 22],
      [NaN, anchor.z, 22], [anchor.x, Infinity, 22], [anchor.x, anchor.z, NaN],
      [anchor.x, anchor.z, Infinity], [anchor.x, anchor.z, -Infinity],
    ]) expect(castleInteriorRecoverSurface(x, z, y, unreadable)).toBeNull();
  });

  it('ComputesBothRampLanesAndTheLandingFromTheTaggedStair', () => {
    CASTLE_STAIRS.forEach((st, stairIndex) => {
      const grid: CastleGridAccessor = (level) => level === st.lo ? stairIndex + 2 : 0;
      const lo = CASTLE_LEVELS[st.lo].y, hi = CASTLE_LEVELS[st.hi].y, mid = (lo + hi) / 2;
      for (const [u, v, y, level] of [
        [st.u0 + st.runLen / 2, st.v0 + st.laneW / 2, (lo + mid) / 2, st.lo],
        [st.u0 + st.runLen / 2, st.v0 + st.laneW + st.gap + st.laneW / 2, (hi + mid) / 2, st.hi],
        [st.u0 + st.runLen + st.landingD / 2, st.v0 + st.laneW / 2, mid, st.hi],
      ]) {
        const x = anchor.x + (st.axis === 'z' ? v : u), z = anchor.z + (st.axis === 'z' ? u : v);
        const surface = castleInteriorRecoverSurface(x, z, y, grid);
        expect(surface?.y).toBeCloseTo(y, 8);
        expect(surface?.level).toBe(level);
      }
      const u = st.u0 + st.runLen / 2, v = st.v0 + st.laneW + st.gap / 2;
      expect(castleInteriorRecoverSurface(
        anchor.x + (st.axis === 'z' ? v : u), anchor.z + (st.axis === 'z' ? u : v), mid, grid,
      )).toBeNull();
    });
  });

  it('ScansEveryLevelAndKeepsTheHighestEligibleSurface', () => {
    expect(scanCastleInteriorSurface(anchor.x, anchor.z, 0, 50, () => 1)).toEqual({ y: 41.2, level: 4 });
    expect(castleInteriorRecoverSurface(anchor.x, anchor.z, 11, () => 1)).toEqual({ y: 11, level: 1 });
  });

  it('RecoversOnTheEmittedGrandStairWhenTheStoredFloorIsStale', () => {
    const st = CASTLE_STAIRS.find((stair) => stair.id === 'grand1')!;
    const x = anchor.x + st.v0 + st.laneW / 2;
    const z = anchor.z + st.u0 + st.runLen / 2;
    const claimedY = 13.75; // halfway up grand1's lower lane: 11 -> 16.5.
    expect(castleInteriorSurfaceAt(x, z, 11)).toBeNull();
    expect(castleInteriorRecoverSurface(x, z, claimedY)).toEqual({ y: claimedY, level: 1 });
    // A claim ABOVE the real surface (airborne on a descent) recovers down onto it, up to STEP_DOWN.
    expect(castleInteriorRecoverSurface(x, z, claimedY + 0.3)).toEqual({ y: claimedY, level: 1 });
    expect(castleInteriorRecoverSurface(x, z, claimedY + 1.3)).toEqual({ y: claimedY, level: 1 });
    expect(castleInteriorRecoverSurface(x, z, claimedY + 1.5)).toBeNull();
    // A claim BELOW the real surface never recovers upward past the tolerance (no floor-through).
    expect(castleInteriorRecoverSurface(x, z, claimedY - 0.2)).toEqual({ y: claimedY, level: 1 });
    expect(castleInteriorRecoverSurface(x, z, claimedY - 0.3)).toBeNull();
  });
});
