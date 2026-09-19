/**
 * dungeon/interiorNav.ts — one interior-nav engine, parameterized by dungeon.
 *
 * Every function here used to live in `castle/surface.ts`, closed over
 * `CASTLE_NAV_META` / `CASTLE_LEVELS` / `CASTLE_STAIRS` at module scope. That
 * made "resolve an interior step" structurally answerable for exactly one
 * dungeon: the Barrowdeep's own bitmaps shipped in `barrowdeep/navGrids.ts`
 * (M11-5) and nothing could read them, so wall collision inside it was not
 * enforced at all, its mobs could not move, and `movePlayer` zeroed the
 * player's `floorYM` on their first step inside while the instance's mobs sat
 * on their real 11.0 / 0.6 floors (D174 item 3, widened by PR #374's review).
 *
 * The transform is M10-4/M10-5's, applied to the server's interior nav:
 * descriptor table in, module-scope constants out, existing output
 * byte-identical. Every entry point takes a `DungeonInteriorNav` first
 * argument, and `castle/surface.ts` is now a thin facade binding these to
 * Castle Ashwood's own descriptor so every existing caller and test is
 * unchanged.
 *
 * Coordinates: `meta.anchor` and `meta.bounds` are ZONE-LOCAL metres in
 * `zoneId`, so each descriptor carries its zone's `originOffsetM` (read from
 * the zone manifest, never re-typed) and `pxToWorldM` / `worldMToPx` below
 * fold it in. Zone 1's offset is (0, 0), which is why every Castle Ashwood
 * path through here reproduces the retired code exactly.
 */

import { ZONES_BY_ID } from '../content/index.js';

export type Surface = { y: number; level: number };

/** Supplies an emitted nav cell's surface tag: 0 blocked, 1 floor, 2+ stair index + 2. */
export type InteriorGridAccessor = (level: number, cellIndex: number) => number;

/** The `*_NAV_META` shape both emitters produce. */
export interface InteriorNavMeta {
  readonly anchor: { readonly x: number; readonly z: number };
  readonly bounds: {
    readonly x0: number; readonly z0: number;
    readonly x1: number; readonly z1: number;
  };
  readonly navCellM: number;
  readonly cols: number;
  readonly rows: number;
  readonly levelCount: number;
}

/** The `*_LEVELS` shape, narrowed to what resolution actually reads. */
export interface InteriorNavLevel {
  readonly y: number;
}

/** The `*_STAIRS` shape, narrowed the same way. */
export interface InteriorNavStair {
  readonly lo: number;
  readonly hi: number;
  readonly axis: string;
  readonly u0: number;
  readonly runLen: number;
  readonly landingD: number;
  readonly laneW: number;
  readonly gap: number;
  readonly v0: number;
}

/** What a dungeon must declare to get interior nav; all of it emitted data. */
export interface InteriorNavSpec {
  readonly dungeonId: string;
  /** The zone this interior's anchor/bounds are local to (its DungeonDef.entrance.zoneId). */
  readonly zoneId: number;
  readonly meta: InteriorNavMeta;
  readonly bitmapsB64: readonly string[];
  readonly levels: readonly InteriorNavLevel[];
  readonly stairs: readonly InteriorNavStair[];
  readonly stepUp: number;
  readonly stepDown: number;
  /**
   * Index into `levels` of the storey the interior spawn point stands on —
   * the floor `enterDungeon` seeds the player at, and the reference floor a
   * step with no stored floor resolves against. Declared rather than derived
   * because deriving it means decoding the whole grid at module load; it is
   * pinned against an actual scan of the committed bitmaps at the dungeon's
   * own `spawnLocal` by dungeonInteriorNav.test.ts.
   */
  readonly entryLevelIndex: number;
}

export interface DungeonInteriorNav extends InteriorNavSpec {
  /** This interior's zone origin offset (metres), from the zone manifest. */
  readonly originOffsetM: { readonly x: number; readonly z: number };
  /** `levels[entryLevelIndex].y` — the entry storey's walkable floor Y. */
  readonly entryFloorYM: number;
  /** Lazily decoded, per descriptor: a dungeon nobody enters costs nothing. */
  readonly readCell: InteriorGridAccessor;
}

export const INTERIOR_RECOVERY_TOLERANCE_M = 0.25;

function decodeBase64(b64: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;

  const len = b64.length;
  const outLen = (len * 3) >> 2;
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = lookup[b64.charCodeAt(i)];
    const b = lookup[b64.charCodeAt(i + 1)];
    const c = lookup[b64.charCodeAt(i + 2)];
    const d = lookup[b64.charCodeAt(i + 3)];
    out[o++] = (a << 2) | (b >> 4);
    if (b64[i + 2] !== '=') out[o++] = ((b & 15) << 4) | (c >> 2);
    if (b64[i + 3] !== '=') out[o++] = ((c & 3) << 6) | d;
  }
  return out;
}

/**
 * Build a dungeon's interior descriptor.
 *
 * The zone origin offset is READ from the manifest rather than re-typed, so
 * moving a zone's origin cannot leave an interior resolving against the old
 * one — the exact class of bug D173 item 2 was. An unknown zone id falls back
 * to (0, 0) for the same reason `contentPosToPx` does: a reducer must not
 * abort a transaction over content `validateContent` already rejects.
 */
export function makeInteriorNav(spec: InteriorNavSpec): DungeonInteriorNav {
  let decoded: Uint16Array[] | null = null;
  const readCell: InteriorGridAccessor = (level, cellIndex) => {
    if (!decoded) {
      decoded = spec.bitmapsB64.map((b64) => {
        const bytes = decodeBase64(b64);
        return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
      });
    }
    return decoded[level][cellIndex];
  };
  const zone = ZONES_BY_ID[spec.zoneId];
  return {
    ...spec,
    originOffsetM: zone
      ? { x: zone.originOffsetM.x, z: zone.originOffsetM.z }
      : { x: 0, z: 0 },
    entryFloorYM: spec.levels[spec.entryLevelIndex].y,
    readCell,
  };
}

function stairSurfaceY(
  nav: DungeonInteriorNav, st: InteriorNavStair, x: number, z: number,
): number | null {
  const yLo = nav.levels[st.lo].y;
  const yHi = nav.levels[st.hi].y;
  const yMid = (yLo + yHi) / 2;
  const u = st.axis === 'z' ? z : x;
  const v = st.axis === 'z' ? x : z;
  const u1 = st.u0 + st.runLen;
  const u2 = u1 + st.landingD;
  const vA0 = st.v0, vA1 = st.v0 + st.laneW;
  const vB0 = vA1 + st.gap, vB1 = vB0 + st.laneW;

  if (u >= u1 && u <= u2 && v >= vA0 && v <= vB1) return yMid;
  if (u < st.u0 || u > u1) return null;
  const t = (u - st.u0) / st.runLen;
  if (v >= vA0 && v <= vA1) return yLo + t * (yMid - yLo);
  if (v >= vB0 && v <= vB1) return yHi + t * (yMid - yHi);
  return null;
}

/** Shared pure scan; the accessor supplies the emitted nav cell's surface tag. */
export function scanInteriorSurface(
  nav: DungeonInteriorNav,
  wx: number, wz: number, minY: number, maxY: number, readCell: InteriorGridAccessor,
): Surface | null {
  if (!Number.isFinite(wx) || !Number.isFinite(wz) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
  const { anchor, bounds, navCellM, cols, rows } = nav.meta;
  const x = wx - anchor.x, z = wz - anchor.z;
  if (x < bounds.x0 || x >= bounds.x1 || z < bounds.z0 || z >= bounds.z1) return null;

  const col = Math.floor((x - bounds.x0) / navCellM);
  const row = Math.floor((z - bounds.z0) / navCellM);
  if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
  const idx = row * cols + col;
  let bestY = -Infinity, bestLevel = -1;
  for (let li = 0; li < nav.meta.levelCount; li++) {
    const v = readCell(li, idx);
    if (v === 0) continue;
    let y: number, level = li;
    if (v === 1) {
      y = nav.levels[li].y;
    } else {
      const st = nav.stairs[v - 2];
      if (!st) continue;
      const u = Math.min(Math.max(st.axis === 'z' ? z : x, st.u0), st.u0 + st.runLen + st.landingD);
      const sy = st.axis === 'z' ? stairSurfaceY(nav, st, x, u) : stairSurfaceY(nav, st, u, z);
      if (sy == null) continue;
      y = sy;
      level = y >= (nav.levels[st.lo].y + nav.levels[st.hi].y) / 2 ? st.hi : st.lo;
    }
    if (y <= maxY && y >= minY && y > bestY) {
      bestY = y; bestLevel = level;
    }
  }
  return bestLevel >= 0 ? { y: bestY, level: bestLevel } : null;
}

/**
 * D92: recover only onto a real cell surface near the claimed floor, never the stored floor.
 * The window is asymmetric: a surface may sit up to `stepDown` below the claimed floor
 * (a sprinting client flies off treads on a descent and keeps claiming its last grounded floor
 * while the ramp under it is already ~1 m lower — accepting a surface BELOW the claim can never
 * let a client stand on a floor it fell through), but only INTERIOR_RECOVERY_TOLERANCE_M above it.
 */
export function interiorRecoverSurface(
  nav: DungeonInteriorNav,
  wx: number, wz: number, claimedY: number, readCell: InteriorGridAccessor = nav.readCell,
): Surface | null {
  return scanInteriorSurface(
    nav, wx, wz, claimedY - nav.stepDown, claimedY + INTERIOR_RECOVERY_TOLERANCE_M, readCell,
  );
}

/**
 * STDB px → zone-local metres, one axis at a time. `originOffsetM` is that
 * axis's component of the owning zone's `originOffsetM` (world/zones.ts) —
 * 0, zone 1's value, reproduces this function's exact pre-fix output.
 *
 * Kept scalar/per-axis, unlike world/zones.ts's contentPosToPx, because the
 * interior nav-bitmap math here (scanInteriorSurface, isInInterior) calls it
 * one axis at a time, and contentPosToPx's Math.round would perturb the
 * sub-pixel wall-slide math this feeds on the movePlayer hot path — the
 * "byte-identical" bar this is held to rules that out (D173 item 3).
 * worldMToPx below takes the same parameter for the same reason.
 */
export function pxToWorldM(px: number, originOffsetM = 0): number {
  return (px - 1600) / 32 - originOffsetM;
}

/** Zone-local metres → STDB px, one axis at a time. See pxToWorldM above — same reasoning, same default. */
export function worldMToPx(m: number, originOffsetM = 0): number {
  return (m + originOffsetM) * 32 + 1600;
}

export function isInInterior(
  nav: DungeonInteriorNav, worldXM: number, worldZM: number,
): boolean {
  const { anchor, bounds } = nav.meta;
  const lx = worldXM - anchor.x;
  const lz = worldZM - anchor.z;
  return lx >= bounds.x0 && lx < bounds.x1 && lz >= bounds.z0 && lz < bounds.z1;
}

/** null = outside this dungeon's interior; otherwise the surface reachable at currentY. */
export function interiorSurfaceAt(
  nav: DungeonInteriorNav,
  worldXM: number,
  worldZM: number,
  currentY: number,
): Surface | null {
  if (!isInInterior(nav, worldXM, worldZM)) return null;
  return scanInteriorSurface(
    nav, worldXM, worldZM, currentY - nav.stepDown, currentY + nav.stepUp, nav.readCell,
  );
}

/** Wall-slide one interior step — mirrors castleNav.resolveMove / castleNavSurface.js. */
export function interiorResolveMove(
  nav: DungeonInteriorNav,
  prevXM: number,
  prevZM: number,
  nextXM: number,
  nextZM: number,
  currentY: number,
): { x: number; z: number; floorYM: number; surface: Surface | null } {
  let x = nextXM;
  let z = nextZM;
  let s = interiorSurfaceAt(nav, x, z, currentY);
  if (!s) {
    s = interiorSurfaceAt(nav, x, prevZM, currentY);
    if (s) { z = prevZM; }
    else {
      s = interiorSurfaceAt(nav, prevXM, z, currentY);
      if (s) { x = prevXM; }
      else {
        x = prevXM; z = prevZM;
        s = interiorSurfaceAt(nav, prevXM, prevZM, currentY);
      }
    }
  }
  return { x, z, floorYM: s ? s.y : currentY, surface: s };
}

/** null = skip validation; false = blocked; true = allowed. */
export function interiorMoveAllowed(
  nav: DungeonInteriorNav,
  worldXM: number,
  worldZM: number,
  currentY: number,
): boolean | null {
  if (!isInInterior(nav, worldXM, worldZM)) return null;
  return interiorSurfaceAt(nav, worldXM, worldZM, currentY) != null;
}

/**
 * D92 recovery, bounded by the STORED floor: the claimed floorYM is client-controlled, so a
 * recovered surface must also lie within `stepDown` of the row's own floor. A freeze only
 * ever accumulates in sub-`stepUp` steps (the strict window), so every real freeze is within
 * reach, while a spoofed claim of another level (floors are >= 9.6 m apart) is refused.
 */
export function recoverNearStoredFloor(
  nav: DungeonInteriorNav, wx: number, wz: number, claimedY: number, storedY: number,
): Surface | null {
  const recovered = interiorRecoverSurface(nav, wx, wz, claimedY);
  if (!recovered || Math.abs(recovered.y - storedY) > nav.stepDown) return null;
  return recovered;
}

/** Accepted interior position (STDB px) plus the floor it resolved onto. */
export interface InteriorStep {
  x: number;
  y: number;
  floorYM: number;
}

/**
 * `movePlayer`'s whole interior branch, as a pure function — `null` means
 * "reject this move" (the reducer returns without writing the row).
 *
 * Lifted out of index.ts verbatim so it is unit-testable without a
 * spacetimedb/server runtime, the way world/travel.ts's resolveGateTravel and
 * world/moveGuard.ts's clampMoveToMaxSpeed already are. Nothing about the
 * decision changed; the `CASTLE_*` constants it closed over became `nav.*`.
 *
 * `storedFloorYM` is the row's own floor (0 = none yet, i.e. the player just
 * teleported in); `claimedFloorYM` is the client's claim for this call and is
 * never trusted beyond selecting a recovery window.
 */
export function resolveInteriorStep(
  nav: DungeonInteriorNav,
  prevPxX: number,
  prevPxY: number,
  storedFloorYM: number,
  nextPxX: number,
  nextPxY: number,
  claimedFloorYM: number,
  guardClamped: boolean,
): InteriorStep | null {
  const ox = nav.originOffsetM.x;
  const oz = nav.originOffsetM.z;
  const worldXM = pxToWorldM(nextPxX, ox);
  const worldZM = pxToWorldM(nextPxY, oz);

  // Strict resolution starts at the stored floor. D92 recovery is considered
  // only after rejection, and still requires a real surface at the guarded XZ.
  const refY = storedFloorYM > 0 ? storedFloorYM : nav.entryFloorYM;

  if (guardClamped) {
    // A shortened step is projected along the straight chord to the claim,
    // and indoors that chord can clip a wall even when both endpoints are
    // walkable — so the guard could synthesise a nav-blocked point out of
    // a legal move and wedge the row. Resolve it the same way the client
    // resolves its own steps (wall-slide per axis, else stay put), which
    // walks the corner the chord cut. interiorResolveMove always returns a
    // surface when the stored position has one, so a clamped step can no
    // longer strand the row on a rejection.
    const resolved = interiorResolveMove(
      nav, pxToWorldM(prevPxX, ox), pxToWorldM(prevPxY, oz), worldXM, worldZM, refY,
    );
    if (!resolved.surface || (claimedFloorYM > 0 && Math.abs(claimedFloorYM - resolved.floorYM) > nav.stepUp)) {
      const recovered = recoverNearStoredFloor(nav, worldXM, worldZM, claimedFloorYM, refY);
      if (!recovered) return null;
      // Keep the upstream speed-clamped endpoint, never the unguarded claim.
      return { x: nextPxX, y: nextPxY, floorYM: recovered.y };
    }
    return {
      x: worldMToPx(resolved.x, ox),
      y: worldMToPx(resolved.z, oz),
      floorYM: resolved.floorYM,
    };
  }

  // Unclamped claims keep the strict all-or-nothing check: the client
  // already wall-slides locally, so a blocked point here is spoofed or
  // desynced and should be refused rather than quietly slid.
  let surface = interiorSurfaceAt(nav, worldXM, worldZM, refY)
    ?? recoverNearStoredFloor(nav, worldXM, worldZM, claimedFloorYM, refY);
  if (!surface) return null;
  if (claimedFloorYM > 0 && Math.abs(claimedFloorYM - surface.y) > nav.stepUp) {
    surface = recoverNearStoredFloor(nav, worldXM, worldZM, claimedFloorYM, refY);
    if (!surface) return null;
  }
  return { x: nextPxX, y: nextPxY, floorYM: surface.y };
}

/**
 * One interior mob step, wall-slid against `nav`'s OWN grid.
 *
 * Takes the already-stepped target px rather than the destination + a step
 * length, so `tickMobAI`'s indoor and outdoor branches keep sharing one
 * stepper (`stepToward`) and cannot drift apart. `landed` is false when no
 * surface was found even after the slide, which is what turns into
 * `arrived: false` at the call site.
 *
 * This is the second half of the same gap `resolveInteriorStep` closes: before
 * R21 the mob path converted px with a hardcoded zero origin offset and queried
 * Castle Ashwood's grid for EVERY dungeon, so a Barrowdeep mob resolved to no
 * surface, was handed back its previous position, and never chased or returned.
 */
export function interiorMobStepPx(
  nav: DungeonInteriorNav,
  fromPxX: number,
  fromPxY: number,
  stepPxX: number,
  stepPxY: number,
  floorYM: number,
): { x: number; y: number; floorYM: number; landed: boolean } {
  const ox = nav.originOffsetM.x;
  const oz = nav.originOffsetM.z;
  const resolved = interiorResolveMove(
    nav,
    pxToWorldM(fromPxX, ox), pxToWorldM(fromPxY, oz),
    pxToWorldM(stepPxX, ox), pxToWorldM(stepPxY, oz),
    floorYM,
  );
  return {
    x: worldMToPx(resolved.x, ox),
    y: worldMToPx(resolved.z, oz),
    floorYM: resolved.floorYM,
    landed: resolved.surface != null,
  };
}

/**
 * Resolve a mob's floor Y from its px position when `floorYM` was unset
 * (migration backfill). Scans this dungeon's own levels, not Castle Ashwood's.
 */
export function interiorFloorYAtPx(
  nav: DungeonInteriorNav, pxX: number, pxY: number, fallback: number,
): number {
  const wx = pxToWorldM(pxX, nav.originOffsetM.x);
  const wz = pxToWorldM(pxY, nav.originOffsetM.z);
  for (const lv of nav.levels) {
    const s = interiorSurfaceAt(nav, wx, wz, lv.y);
    if (s) return s.y;
  }
  return fallback;
}
