/**
 * barrowdeepPlan — The Barrowdeep's single source of truth (D169–D172, D175).
 *
 * Pure data + pure math. No Babylon, no I/O — runs in Node (vitest) and in
 * every client identically. Structural mirror of
 * src/features/world/castle/castlePlan.js: same export names, same rect/door/
 * stair vocabulary, same SEAM comments, so the emitter, the Unity importer
 * and the server all read one shape for both dungeons. There is no
 * `dungeons/` directory on the web side — castlePlan.js is the pattern.
 *
 * Deliberately NOT a set of Babylon builders. The web app's Babylon world is
 * frozen (reference only); the Barrowdeep's geometry, lighting and props are
 * built in Unity from this plan (M11-11/M11-12), and D172 rules out a second
 * interior material set entirely — the material spec below is Castle
 * Ashwood's own object, shared by reference, not a copy.
 *
 * Coordinate scheme:
 *   - All rects/positions are in INTERIOR-LOCAL meters. Zone-local position =
 *     local + INTERIOR_ANCHOR, and INTERIOR_ANCHOR is zone-local to ZONE 2
 *     (not world) — see its own comment. The exterior mound lives separately
 *     at EXTERIOR.site on Zone 2's terrain.
 *   - Rects are { x0, z0, x1, z1 } with x0 < x1, z0 < z1.
 *   - levels[i].y is the walkable floor SURFACE height for level i.
 *
 * SEAM:layout-manifest — this object is JSON-serializable (minus the helper
 * functions); scripts/emit-barrowdeep-manifest.mjs emits it as
 * DungeonDef.layoutManifest.
 */

import {
  MATERIAL_SPEC as CASTLE_MATERIAL_SPEC,
  NAV_CELL as CASTLE_NAV_CELL,
  PLAYER_R as CASTLE_PLAYER_R,
  PLAYER_SKIN as CASTLE_PLAYER_SKIN,
  STEP_UP as CASTLE_STEP_UP,
  SLAB_T as CASTLE_SLAB_T,
  WALL_T as CASTLE_WALL_T,
} from '../castle/castlePlan.js';

// ── Navigation / construction constants ─────────────────────────────────────
// Imported, never re-typed. D171's whole argument for reusing Castle
// Ashwood's level Y values verbatim is that the server and Unity carry NO new
// constants for a second dungeon; re-declaring these as literals here would
// quietly re-open exactly that, because a later edit to one file would not
// move the other. barrowdeepPlan.test.js pins the identity.
export const WALL_T      = CASTLE_WALL_T;    // wall thickness (walls sit centered on room edges)
export const PLAYER_R    = CASTLE_PLAYER_R;  // player capsule radius baked into the nav grid inset
export const PLAYER_SKIN = CASTLE_PLAYER_SKIN; // extra analytic margin (exterior shell + camera probes)
export const STEP_UP     = CASTLE_STEP_UP;   // max step-up per move (stair seams, thresholds)
export const NAV_CELL    = CASTLE_NAV_CELL;  // nav grid cell size in meters
export const SLAB_T      = CASTLE_SLAB_T;    // floor slab thickness (slab top = level y)

/**
 * Room-kind → material keys. D172: **no new interior material set.** This is
 * Castle Ashwood's own frozen object, shared by reference — not a copy and
 * not a subset — so it is structurally impossible for the Barrowdeep to
 * introduce a floor material Ashwood does not already ship. Every room `kind`
 * below is one of the four dark-stone dungeon kinds
 * (`dungeonHall`, `cells`, `guard`, `vault`), pinned by the test.
 *
 * wallByLevel is per-dungeon (Ashwood's is 5 entries, one per storey), so it
 * is stated here — but drawn from Ashwood's own palette: a barrow is dark
 * stone top to bottom. windowedKinds/fancyKinds are empty: a barrow has no
 * windows and nothing gilded. Differentiation is plan, lighting and props
 * (Unity's per-level `CastleLightingAuthoring` profiles), not material.
 */
export const MATERIAL_SPEC = Object.freeze({
  floorByKind: CASTLE_MATERIAL_SPEC.floorByKind,
  wallByLevel: Object.freeze([
    CASTLE_MATERIAL_SPEC.wallByLevel[0], // 'darkStone' — deep
    CASTLE_MATERIAL_SPEC.wallByLevel[0], // 'darkStone' — gallery
  ]),
  windowedKinds: Object.freeze([]),
  fancyKinds: Object.freeze([]),
});

// Interior-local bounds (nav grid + slab extents). D171 fixes these at
// ±44 x, ±32 z — 88 × 64 m, i.e. 352 × 256 = 90,112 cells per level and
// 180,224 across both, 22.3 % of Castle Ashwood's 808,500. Changing either
// number changes the emitted module's size by hundreds of kilobytes, so the
// test pins the cell count, not just the extents.
//
// Unlike Castle Ashwood, the Barrowdeep is authored directly in metres:
// PLAN_SCALE is 1 because a barrow warren has no repeating base-unit grid to
// scale (Ashwood's 1.75 exists because its rooms were authored in a 2 m
// module and then grown). The multiplication is kept anyway — × 1 is exact in
// IEEE 754 — so this file stays a structural mirror and the emitted manifest
// keeps `planScale`, which the Unity `CastleLayoutDto` already reads.
export const PLAN_SCALE = 1;
const SXZ = PLAN_SCALE;
export const LOCAL_BOUNDS = Object.freeze({
  x0: -44 * SXZ, z0: -32 * SXZ, x1: 44 * SXZ, z1: 32 * SXZ,
});

// ── Levels ───────────────────────────────────────────────────────────────────
// D171: level Y values are Castle Ashwood's **verbatim** — level 1 (the entry
// level) at 11.0, level 0 at 0.6. That is not laziness: it means
// `DungeonFlow.DefaultSpawnFloorY = 11f`, the `CASTLE_LEVELS`-shaped floor
// resolution inside movePlayer and `CASTLE_STEP_UP` all carry over with no new
// constants, and a barrow whose entrance is on top and whose burials are below
// is structurally the same relationship as Ashwood's ground-over-dungeon.
//
// `clear` = wall height, chosen so walls meet the next level's slab exactly
// (y + clear === nextY - SLAB_T): 0.6 + 9.8 === 11.0 - 0.6. The top level has
// no slab above it, so it takes Ashwood's own top-level clear (9.0).
export const LEVELS = Object.freeze([
  { id: 'deep',    y: 0.6,  clear: 9.8 }, // 0 — burials, hoard, warden, the Thane's cairn
  { id: 'gallery', y: 11.0, clear: 9.0 }, // 1 — entry passage, fore hall, niches, stair pit
]);

// ── Rooms ────────────────────────────────────────────────────────────────────
// D171's room programme, verbatim: 7 per level, 14 total. `kind` drives the
// material palette and (in Unity) the fit-out. Rooms on a level tile
// edge-to-edge; walls sit on shared edges.
const RAW_ROOMS = [
  // ═══ DEEP (level 0) — the warren the barrow was actually dug for ═══════════
  { id: 'thaneCairn',    level: 0, rect: { x0: -32, z0: -14, x1: -2, z1: 14 }, kind: 'dungeonHall' },
  { id: 'deepCorridor',  level: 0, rect: { x0: -2,  z0: -4,  x1: 24, z1: 4  }, kind: 'dungeonHall' },
  { id: 'burialNorth',   level: 0, rect: { x0: -2,  z0: 4,   x1: 24, z1: 22 }, kind: 'cells' },
  { id: 'burialSouth',   level: 0, rect: { x0: -2,  z0: -22, x1: 24, z1: -4 }, kind: 'cells' },
  { id: 'deepVestibule', level: 0, rect: { x0: 24,  z0: -8,  x1: 40, z1: 8  }, kind: 'dungeonHall' },
  { id: 'hoardChamber',  level: 0, rect: { x0: 24,  z0: 8,   x1: 40, z1: 26 }, kind: 'vault' },
  { id: 'wardenCell',    level: 0, rect: { x0: 24,  z0: -26, x1: 40, z1: -8 }, kind: 'guard' },

  // ═══ GALLERY (level 1) — the entry level, under the mound's turf ═══════════
  { id: 'entryPassage',     level: 1, rect: { x0: -42, z0: -5,  x1: -26, z1: 5  }, kind: 'dungeonHall' },
  { id: 'foreHall',         level: 1, rect: { x0: -26, z0: -14, x1: -8,  z1: 14 }, kind: 'dungeonHall' },
  { id: 'nicheWest',        level: 1, rect: { x0: -26, z0: 14,  x1: -17, z1: 26 }, kind: 'cells' },
  { id: 'nicheEast',        level: 1, rect: { x0: -17, z0: 14,  x1: -8,  z1: 26 }, kind: 'cells' },
  { id: 'collapsedGallery', level: 1, rect: { x0: -8,  z0: -8,  x1: 24,  z1: 8  }, kind: 'dungeonHall' },
  { id: 'stairPit',         level: 1, rect: { x0: 24,  z0: -8,  x1: 40,  z1: 8  }, kind: 'dungeonHall' },
  { id: 'vestibule',        level: 1, rect: { x0: 24,  z0: 8,   x1: 40,  z1: 26 }, kind: 'guard' },
];
export const ROOMS = Object.freeze(RAW_ROOMS.map((r) => ({
  ...r,
  rect: { x0: r.rect.x0 * SXZ, z0: r.rect.z0 * SXZ, x1: r.rect.x1 * SXZ, z1: r.rect.z1 * SXZ },
})));

// ── Doors ────────────────────────────────────────────────────────────────────
// Openings between two rooms sharing an edge. edge: 'x' means the shared wall
// line runs along z at x = at (door crosses it); 'z' means the wall line runs
// along x at z = at. lo..hi is the opening extent along the line.
// b: 'EXTERIOR' marks the west-facing lintel doorway (teleport interface, not
// a nav strip). 15 doors, per D171.
const RAW_DOORS = [
  // deep
  { id: 'bd_thane',    a: 'deepCorridor',  b: 'thaneCairn',    edge: 'x', at: -2, lo: -3.3, hi: 3.3, arch: true },
  { id: 'bd_burialNW', a: 'deepCorridor',  b: 'burialNorth',   edge: 'z', at: 4,  lo: 2,   hi: 5 },
  { id: 'bd_burialNE', a: 'deepCorridor',  b: 'burialNorth',   edge: 'z', at: 4,  lo: 16,  hi: 19 },
  { id: 'bd_burialSW', a: 'deepCorridor',  b: 'burialSouth',   edge: 'z', at: -4, lo: 2,   hi: 5 },
  { id: 'bd_burialSE', a: 'deepCorridor',  b: 'burialSouth',   edge: 'z', at: -4, lo: 16,  hi: 19 },
  { id: 'bd_deepVest', a: 'deepCorridor',  b: 'deepVestibule', edge: 'x', at: 24, lo: -3.3, hi: 3.3, arch: true },
  { id: 'bd_hoard',    a: 'deepVestibule', b: 'hoardChamber',  edge: 'z', at: 8,  lo: 28,  hi: 31, iron: true },
  { id: 'bd_warden',   a: 'deepVestibule', b: 'wardenCell',    edge: 'z', at: -8, lo: 28,  hi: 31 },
  // gallery
  { id: 'bd_gate',     a: 'entryPassage',     b: 'EXTERIOR',        edge: 'x', at: -42, lo: -2.2, hi: 2.2, sealed: true },
  { id: 'bd_fore',     a: 'entryPassage',     b: 'foreHall',        edge: 'x', at: -26, lo: -3,  hi: 3, arch: true },
  { id: 'bd_nicheW',   a: 'foreHall',         b: 'nicheWest',       edge: 'z', at: 14,  lo: -24, hi: -21 },
  { id: 'bd_nicheE',   a: 'foreHall',         b: 'nicheEast',       edge: 'z', at: 14,  lo: -15, hi: -12 },
  { id: 'bd_gallery',  a: 'foreHall',         b: 'collapsedGallery', edge: 'x', at: -8, lo: -3.3, hi: 3.3, arch: true },
  { id: 'bd_stair',    a: 'collapsedGallery', b: 'stairPit',        edge: 'x', at: 24,  lo: -3.3, hi: 3.3, arch: true },
  { id: 'bd_vest',     a: 'stairPit',         b: 'vestibule',       edge: 'z', at: 8,   lo: 28,  hi: 31 },
];
export const DOORS = Object.freeze(RAW_DOORS.map((d) => ({
  ...d, at: d.at * SXZ, lo: d.lo * SXZ, hi: d.hi * SXZ,
})));

// ── Stairs ───────────────────────────────────────────────────────────────────
// One U-shaped switchback (D171), in the stairPit / deepVestibule pair — the
// same stacked-room-pair arrangement Castle Ashwood uses for its own
// dungeon↔ground stair. Two lanes run along `axis` (u); lanes are offset along
// the perpendicular (v). Lane A rises from the LOWER level's floor at u0 to the
// mid-landing at u0+runLen; the landing spans both lanes; lane B returns from
// the landing to u0, arriving at the UPPER level's floor. The upper floor slab
// gets a shaft hole over the whole footprint.
//
// runLen/landingD/laneW/gap are Castle Ashwood's `dstair` values at ITS final
// (post-PLAN_SCALE) scale, not re-tuned: the Y rise is identical (11.0 − 0.6 =
// 10.4 m, D171's verbatim level Y), so reusing the run length reproduces
// Ashwood's exact ramp gradient rather than inventing a second one. Pinned by
// the test against castlePlan's own STAIRS[0].
const RAW_STAIRS = [
  { id: 'bdstair', lo: 0, hi: 1, axis: 'x', u0: 26, runLen: 8.75, landingD: 4.2,
    laneW: 4.55, gap: 0.875, v0: -4.9875 },
];
export const STAIRS = Object.freeze(RAW_STAIRS.map((st) => ({
  ...st,
  u0: st.u0 * SXZ, runLen: st.runLen * SXZ, landingD: st.landingD * SXZ,
  laneW: st.laneW * SXZ, gap: st.gap * SXZ, v0: st.v0 * SXZ,
})));

// ── Double-height voids ──────────────────────────────────────────────────────
// None. A barrow is dug, not built: there is no ballroom to open a gallery
// over. Kept as an explicit empty array so the manifest shape matches Castle
// Ashwood's and the Unity `CastleLayoutDto.voids` list deserializes the same.
export const VOIDS = Object.freeze([]);

// ── Exterior mound + world placement ─────────────────────────────────────────
// D169, re-probed against the live zone2_world.json this pass (the decision
// requires it after any config edit, and M11-4 has since added the exclusions
// entry + chestCount 12). Measured at the chosen site: h = 0.381,
// slope = 0.0280, biome 1 (Cairnfield); the gate at (101.5, −30) measures
// h = −1.339, slope = 0.0545; the r = 26 disc probes clear of
// mountain/forest/water throughout; 76.3 m from the z2_wights camp and 206.5 m
// from the mountain centre against its 176 m margin.
//
// `site` MUST equal zone2_world.json's `exclusions[0]` centre and
// `anchors.barrowdeep`, both of which M11-4 added to reserve exactly this
// footprint. The test reads that config file and pins the equality.
export const EXTERIOR = Object.freeze({
  site: { x: 125, z: -30 },   // Zone 2 terrain site, at the end of the Cairnfield road
  facing: 'west',             // the doorway faces -x, back down the east road
  halfW: 20, halfD: 16,       // turf mound footprint half-extents
  moundH: 7.5,                // mound crown height above the terrain at `site`
  // The west-facing lintel doorway, centred on site.z. `width`/`height` are the
  // opening, matching bd_gate's own lo..hi extent (4.4 m).
  lintel: { z: -30, width: 4.4, height: 4.0 },
  // Standing-stone ring, assembled in Unity from the existing Rock_Large /
  // Ruin_Block prefabs (D172's reuse rule) — M11-12. Radius sits inside the
  // r = 26 exclusion disc so scatter can never collide with it.
  stoneRing: { radiusM: 24, count: 9, stoneH: 3.2 },
});

/** Analytic exterior collision + camera probe constants (derived from EXTERIOR). */
export const SHELL_COLLISION = Object.freeze({
  playerRadiusM: PLAYER_R,
  skinM: PLAYER_SKIN,
  marginM: PLAYER_R + PLAYER_SKIN,
  cameraSkinM: 0.5,
});

/**
 * Interior-local (0,0) in ZONE 2's local metres — NOT world metres.
 *
 * Castle Ashwood's own INTERIOR_ANCHOR is both at once, because zone 1's
 * `originOffsetM` is {0,0}; zone 2's is {3000, 0}, so the two frames differ by
 * 3 km here and a consumer that forgets the offset lands inside zone 1. Every
 * emitted copy of this number therefore ships next to `zoneId` and
 * `originOffsetM` (see the emitter), and the server converts through
 * `contentPosToPx(zoneId, …)`, which reads the offset from the manifest.
 *
 * D175 picks 430 m due east: the interior footprint is 386..474 × −32..32
 * against Zone 2's raised 500 m box (effective reach 499 m after
 * PLAYER_HALF_PX), leaving 25 m of margin, and mirrors Ashwood's own due-east
 * convention rather than inventing a corner placement.
 */
export const INTERIOR_ANCHOR = Object.freeze({ x: 430, z: 0 });

/** The zone this dungeon's entrance and interior both live in. */
export const ZONE_ID = 2;

// Where the player lands when entering / exiting. The two offsets inside the
// doorway are Castle Ashwood's own, to the centimetre: Ashwood spawns
// 9.625 m inside its gate line and puts the exit hotspot 2.625 m inside it
// (castlePlan ENTRY, at PLAN_SCALE 1.75). Re-deriving them from the gate
// rather than re-authoring them keeps the exit hotspot comfortably inside
// DUNGEON_EXIT_RANGE_PX (4 m) without a second tuning pass.
const GATE_LINE_X = -42 * SXZ;
const SPAWN_INSET_M = 9.625;
const EXIT_HOTSPOT_INSET_M = 2.625;

export const ENTRY = Object.freeze({
  spawnLocal: { x: GATE_LINE_X + SPAWN_INSET_M, z: 0 },
  spawnFacing: Math.PI / 2, // avatar yaw: +x, facing into the barrow
  exitHotspotLocal: { x: GATE_LINE_X + EXIT_HOTSPOT_INSET_M, z: 0 },
  // The overworld gate landmark, in ZONE 2 local metres. D169 derives it as
  // site.x - halfW - 3.5, which is Castle Ashwood's own derivation
  // (150 - 34 - 3.5 = 112.5) applied to this mound: 125 - 20 - 3.5 = 101.5.
  gateWorld: { x: EXTERIOR.site.x - EXTERIOR.halfW - 3.5, z: EXTERIOR.lintel.z },
});

// ── Dungeon spawn markers (interior-local) ──────────────────────────────────
// D170/D172: trash is Zone 2's EXISTING overworld roster — L10 `cairn_wight`
// and L12 `frostbound_raider` — reused the way Castle Ashwood reuses
// `restless_bones`/`vale_bandit`. No new trash types. The boss is the only new
// MobDef, and it ships on an existing silhouette.
const RAW_SPAWN_MARKERS = [
  { netId: 'bd_fore',    roomId: 'foreHall',         mobType: 'cairn_wight',       count: 4, radiusM: 8 },
  { netId: 'bd_gallery', roomId: 'collapsedGallery', mobType: 'frostbound_raider', count: 4, radiusM: 7 },
  { netId: 'bd_burial',  roomId: 'burialNorth',      mobType: 'cairn_wight',       count: 4, radiusM: 8 },
  { netId: 'bd_warden',  roomId: 'wardenCell',       mobType: 'frostbound_raider', count: 2, radiusM: 6 },
  { netId: 'bd_boss',    roomId: 'thaneCairn',       mobType: 'cairn_thane',       count: 1, radiusM: 2 },
];

/** Interior-local center of a room rect (post-PLAN_SCALE). */
export function roomCenterLocal(roomId) {
  const r = ROOMS.find((rm) => rm.id === roomId);
  if (!r) throw new Error(`barrowdeepPlan: unknown room "${roomId}"`);
  return {
    x: (r.rect.x0 + r.rect.x1) / 2,
    z: (r.rect.z0 + r.rect.z1) / 2,
  };
}

export const SPAWN_MARKERS = Object.freeze(
  RAW_SPAWN_MARKERS.map((s) => ({ ...s, pos: roomCenterLocal(s.roomId) })),
);

/** The boss marker, resolved from the roster rather than restated. */
export const BOSS_MOB_TYPE = 'cairn_thane';

// ── Aggregate plan object (SEAM:layout-manifest — JSON-serializable) ─────────
export const BARROWDEEP_PLAN = Object.freeze({
  name: 'The Barrowdeep',
  zoneId: ZONE_ID,
  exterior: EXTERIOR,
  interiorAnchor: INTERIOR_ANCHOR,
  bounds: LOCAL_BOUNDS,
  levels: LEVELS,
  rooms: ROOMS,
  doors: DOORS,
  stairs: STAIRS,
  voids: VOIDS,
  entry: ENTRY,
  materialSpec: MATERIAL_SPEC,
  collision: SHELL_COLLISION,
  // SEAM:dungeon-def — DungeonSpawnDef-shaped mob spawns, seeded by the server
  // when the barrow becomes a real instance. Positions are interior-local;
  // zone-local pos = local + interiorAnchor, and px = contentPosToPx(2, that).
  spawnMarkers: SPAWN_MARKERS,
});

// ── Stair math (shared by geometry AND nav — the anti-drift seam) ────────────
// Structural twins of castlePlan's own stairRects/stairSurfaceY, over THIS
// plan's LEVELS. Not imported from castlePlan: stairSurfaceY there closes over
// Castle Ashwood's module-level LEVELS, so importing it would make the
// Barrowdeep's ramp heights silently depend on Ashwood's level table. They
// happen to agree today (D171's verbatim level Y is exactly that claim) — the
// test proves the agreement instead of assuming it.

/** Per-stair derived rects: lanes, landing, full footprint. */
export function stairRects(st) {
  const u1 = st.u0 + st.runLen;
  const u2 = u1 + st.landingD;
  const vA0 = st.v0, vA1 = st.v0 + st.laneW;
  const vB0 = vA1 + st.gap, vB1 = vB0 + st.laneW;
  const mk = (uLo, uHi, vLo, vHi) => st.axis === 'z'
    ? { x0: vLo, z0: uLo, x1: vHi, z1: uHi }
    : { x0: uLo, z0: vLo, x1: uHi, z1: vHi };
  return {
    laneA:     mk(st.u0, u1, vA0, vA1),
    laneB:     mk(st.u0, u1, vB0, vB1),
    landing:   mk(u1, u2, vA0, vB1),
    footprint: mk(st.u0, u2, vA0, vB1),
  };
}

/**
 * Walk-surface height of a stair at a local point, or null when the point is
 * off the stair. THE shared ramp math: the Unity step-mesh builder and the nav
 * grid both derive from this, so stairs always look like they walk.
 */
export function stairSurfaceY(st, x, z) {
  const yLo  = LEVELS[st.lo].y;
  const yHi  = LEVELS[st.hi].y;
  const yMid = (yLo + yHi) / 2;
  const u = st.axis === 'z' ? z : x;
  const v = st.axis === 'z' ? x : z;
  const u1 = st.u0 + st.runLen;
  const u2 = u1 + st.landingD;
  const vA0 = st.v0, vA1 = st.v0 + st.laneW;
  const vB0 = vA1 + st.gap, vB1 = vB0 + st.laneW;

  if (u >= u1 && u <= u2 && v >= vA0 && v <= vB1) return yMid;          // landing
  if (u < st.u0 || u > u1) return null;
  const t = (u - st.u0) / st.runLen;
  if (v >= vA0 && v <= vA1) return yLo + t * (yMid - yLo);               // lane A up
  if (v >= vB0 && v <= vB1) return yHi + t * (yMid - yHi);               // lane B up
  return null;                                                            // railing gap
}

// ── Lookups ──────────────────────────────────────────────────────────────────
export const ROOMS_BY_ID = Object.freeze(
  Object.fromEntries(ROOMS.map((r) => [r.id, r]))
);

export function roomsOnLevel(level) {
  return ROOMS.filter((r) => r.level === level);
}

/** Rect containment with optional inset. */
export function inRect(rect, x, z, inset = 0) {
  return x >= rect.x0 + inset && x <= rect.x1 - inset &&
         z >= rect.z0 + inset && z <= rect.z1 - inset;
}

/**
 * Door opening rect crossing its wall line — used by nav (connector strip)
 * and by the wall builder (hole in the wall segment). `reach` extends the
 * strip past the wall line on both sides so the inset room grids connect.
 */
export function doorStripRect(door, reach = WALL_T / 2 + PLAYER_R + 0.15) {
  const lo = door.lo + PLAYER_R, hi = door.hi - PLAYER_R;
  return door.edge === 'x'
    ? { x0: door.at - reach, z0: lo, x1: door.at + reach, z1: hi }
    : { x0: lo, z0: door.at - reach, x1: hi, z1: door.at + reach };
}

/** The level a door lives on (from its `a` room). */
export function doorLevel(door) {
  return ROOMS_BY_ID[door.a].level;
}
