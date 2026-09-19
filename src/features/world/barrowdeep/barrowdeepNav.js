/**
 * barrowdeepNav — pure-math walkability model for The Barrowdeep's interior.
 *
 * No Babylon, no I/O. Structural mirror of castle/castleNav.js's buildNav,
 * over barrowdeepPlan's own ROOMS/DOORS/STAIRS/LEVELS.
 *
 * It is a mirror rather than a shared core ON PURPOSE, and the choice is
 * narrow: castleNav.buildNav closes over castlePlan's module-level exports,
 * so making it plan-generic means editing the module that emits Castle
 * Ashwood's 2,158,702 committed bytes. That refactor belongs with the same
 * descriptor-table transform M11-8 performs on the Unity builders, where
 * "Ashwood's output is byte-identical" is the stated bar; doing it here would
 * put a content PR on that hook for no content benefit. The cost is this
 * file: a rasteriser with no furniture pass and no voids, ~half the original.
 *
 * Grid encoding per level (Uint16Array, NAV_CELL m cells over LOCAL_BOUNDS):
 *   0            blocked (wall mass, outside every room)
 *   1            flat floor at levels[i].y (rooms, door strips)
 *   2 + k        on stairs[k] — height from stairSurfaceY (ramp / landing)
 *
 * The player radius is baked in at build time: room floors are rasterized
 * inset by PLAYER_R, so collision at runtime is a point test, not a swept
 * circle. Door strips bridge the inset gap across wall lines.
 *
 * COORDINATE FRAME: unlike castleNav's, these queries take ZONE-LOCAL metres
 * (zone 2's frame), because INTERIOR_ANCHOR is zone-local — see
 * barrowdeepPlan's comment on it. Zone 2's origin sits 3000 m east on the
 * shared px plane, so a consumer that feeds world/px metres in here without
 * converting lands inside Zone 1.
 */

import {
  LEVELS, ROOMS, DOORS, STAIRS,
  LOCAL_BOUNDS, NAV_CELL, PLAYER_R, STEP_UP, WALL_T,
  INTERIOR_ANCHOR,
  stairRects, stairSurfaceY, doorStripRect, doorLevel,
} from './barrowdeepPlan.js';

export { STEP_UP };

/**
 * Max drop per move. Castle Ashwood's value, imported in spirit for the same
 * reason the level Y values are verbatim: the emitted server constant
 * (BARROWDEEP_STEP_DOWN) has to agree with the one the interior resolver
 * already uses, and the Barrowdeep's own minimum vertical gap between stacked
 * surfaces (11.0 − 0.6 = 10.4 m, and half a flight = 5.2 m) is far larger
 * than Ashwood's ~2.9 m, so 1.4 m is, if anything, more conservative here.
 */
export const STEP_DOWN = 1.4;

export function buildNav(anchor = INTERIOR_ANCHOR) {
  const b = LOCAL_BOUNDS;
  const cols = Math.ceil((b.x1 - b.x0) / NAV_CELL);
  const rows = Math.ceil((b.z1 - b.z0) / NAV_CELL);
  const grids = LEVELS.map(() => new Uint16Array(cols * rows));

  // cell center in local coords
  const cellX = (c) => b.x0 + (c + 0.5) * NAV_CELL;
  const cellZ = (r) => b.z0 + (r + 0.5) * NAV_CELL;
  const colOf = (x) => Math.floor((x - b.x0) / NAV_CELL);
  const rowOf = (z) => Math.floor((z - b.z0) / NAV_CELL);

  function fillRect(grid, rect, value, clampRect = null) {
    const x0 = Math.max(rect.x0, clampRect ? clampRect.x0 : rect.x0);
    const z0 = Math.max(rect.z0, clampRect ? clampRect.z0 : rect.z0);
    const x1 = Math.min(rect.x1, clampRect ? clampRect.x1 : rect.x1);
    const z1 = Math.min(rect.z1, clampRect ? clampRect.z1 : rect.z1);
    if (x1 <= x0 || z1 <= z0) return;
    const c0 = Math.max(0, colOf(x0)), c1 = Math.min(cols - 1, colOf(x1));
    const r0 = Math.max(0, rowOf(z0)), r1 = Math.min(rows - 1, rowOf(z1));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const x = cellX(c), z = cellZ(r);
        if (x < x0 || x > x1 || z < z0 || z > z1) continue;
        grid[r * cols + c] = value;
      }
    }
  }

  const inset = (rect, m) => ({ x0: rect.x0 + m, z0: rect.z0 + m, x1: rect.x1 - m, z1: rect.z1 - m });

  // 1. Room floors, inset by the player radius (+ half wall: walls sit
  //    centered on room edges, so the walkable area starts inside them).
  const roomInset = PLAYER_R + WALL_T / 2;
  for (const room of ROOMS) {
    fillRect(grids[room.level], inset(room.rect, roomInset), 1);
  }

  // 2. (No double-height voids — a barrow is dug, not built. See plan VOIDS.)

  // 3. Stair shaft holes on the UPPER level (exact footprint — the nav edge
  //    sits at the footprint line so the descent onto lane B stays connected).
  for (const st of STAIRS) {
    fillRect(grids[st.hi], stairRects(st).footprint, 0);
  }

  // 4. Stair ramp/landing surfaces on the LOWER level's grid, clamped inside
  //    the containing room's inset rect so lanes never hug a wall closer than
  //    the player radius.
  STAIRS.forEach((st, k) => {
    const fp = stairRects(st).footprint;
    const loRoom = ROOMS.find((r) => r.level === st.lo &&
      fp.x0 >= r.rect.x0 - 0.01 && fp.x1 <= r.rect.x1 + 0.01 &&
      fp.z0 >= r.rect.z0 - 0.01 && fp.z1 <= r.rect.z1 + 0.01);
    const clamp = loRoom ? inset(loRoom.rect, roomInset) : null;
    fillRect(grids[st.lo], fp, 2 + k, clamp);
  });

  // 5. Door connector strips: flat floor bridging the inset gap across the
  //    wall line. Written last so they override wall-adjacent blocking.
  for (const door of DOORS) {
    if (door.b === 'EXTERIOR') continue; // the lintel is a teleport, not a walk
    fillRect(grids[doorLevel(door)], doorStripRect(door), 1);
  }

  // ── Queries (zone-local coords — anchor subtracted internally) ────────────

  // Stair height with the run coordinate clamped into the stair's u-range:
  // grid cells are NAV_CELL wide, so a cell marked "stair" can catch a query
  // point up to half a cell outside the exact footprint. Clamping u (never v
  // — the railing gap between lanes must stay impassable) keeps the base and
  // top seams continuous instead of flickering null at cell boundaries.
  const stairYCache = STAIRS.map((st) => {
    const u2 = st.u0 + st.runLen + st.landingD;
    return (x, z) => {
      let u = st.axis === 'z' ? z : x;
      const v = st.axis === 'z' ? x : z;
      u = Math.min(Math.max(u, st.u0), u2);
      return st.axis === 'z'
        ? stairSurfaceY(st, v, u)
        : stairSurfaceY(st, u, v);
    };
  });

  /**
   * Highest walkable surface at (zx, zz) reachable from currentY: at most
   * STEP_UP above and STEP_DOWN below it. Returns { y, level } or null when
   * blocked. Inputs are ZONE-LOCAL metres (see the file header).
   */
  function surfaceAt(zx, zz, currentY) {
    const x = zx - anchor.x, z = zz - anchor.z;
    if (x < b.x0 || x >= b.x1 || z < b.z0 || z >= b.z1) return null;
    const idx = rowOf(z) * cols + colOf(x);
    let bestY = -Infinity, bestLevel = -1;
    for (let li = 0; li < grids.length; li++) {
      const v = grids[li][idx];
      if (v === 0) continue;
      let y, level = li;
      if (v === 1) {
        y = LEVELS[li].y;
      } else {
        y = stairYCache[v - 2](x, z);
        if (y == null) continue; // railing gap between lanes
        // Stair cells are rasterized on the LOWER level's grid, but a point
        // high on the ramp (or on the top landing) is physically at the upper
        // storey — attribute it to whichever level's floor height is nearer.
        const st = STAIRS[v - 2];
        level = y >= (LEVELS[st.lo].y + LEVELS[st.hi].y) / 2 ? st.hi : st.lo;
      }
      if (y <= currentY + STEP_UP && y >= currentY - STEP_DOWN && y > bestY) {
        bestY = y; bestLevel = level;
      }
    }
    return bestLevel >= 0 ? { y: bestY, level: bestLevel } : null;
  }

  /** Level index a Y sits on (nearest floor at or below). */
  function levelAtY(y) {
    let best = 0;
    for (let i = 0; i < LEVELS.length; i++) {
      if (y >= LEVELS[i].y - 0.6) best = i;
    }
    return best;
  }

  return {
    anchor, cols, rows, grids,
    surfaceAt, levelAtY,
    // exposed for tests + the emitter
    _local: { colOf, rowOf, cellX, cellZ },
  };
}

/** Convenience: room center in zone-local coords (for tests + spawn points). */
export function roomCenterZoneLocal(roomId, anchor = INTERIOR_ANCHOR) {
  const r = ROOMS.find((rm) => rm.id === roomId);
  if (!r) throw new Error(`barrowdeepNav: unknown room "${roomId}"`);
  return {
    x: (r.rect.x0 + r.rect.x1) / 2 + anchor.x,
    z: (r.rect.z0 + r.rect.z1) / 2 + anchor.z,
    level: r.level,
  };
}
