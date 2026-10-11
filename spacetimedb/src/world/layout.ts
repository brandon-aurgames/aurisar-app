/**
 * world/layout.ts — the overworld seam behind `crossZone` (M14-1, D233).
 *
 * The server keeps D155's offset regions: zone 2's px sit 3000 m east of zone
 * 1's, and movement is unchanged. M14 adds a *layout* on top (content
 * `ZoneDef.layout`, D232): where each zone sits in the one continuous
 * overworld the client renders. Zone 2 is laid out 340 m north of zone 1, so
 * its south pass lands on zone 1's north pass and a player can walk across the
 * seam anywhere along it, not only through the 6 m gate point `travelToZone`
 * accepts (world/travel.ts).
 *
 * A walk across the seam is one `crossZone(destZoneId)` call. It moves the row
 * to the destination zone's px for the SAME layout point, so on screen nothing
 * moves; on the server the row jumps 3000 m, which keeps every px-distance rule
 * (aggro, melee, proximity chat) zone-local, as D248 accepts until M15.
 *
 * Every layout point belongs to exactly one zone: a non-base zone owns its
 * region, and the base owns the rest of its server box (validateContent's
 * layout rules (a)–(g) hold the manifest to that).
 *
 * Pure and free of any `ctx`/`spacetimedb/server` dependency by design, like
 * world/travel.ts and world/fastTravel.ts, so every guard is unit-testable from
 * the root vitest run — see __tests__/crossZone.test.js, and
 * __tests__/mobInsertColumns.test.js for why index.ts itself cannot be
 * executed there.
 */
import { ZONES, ZONES_BY_ID } from '../content/index.js';
import type { ZoneDef } from '../content/types.js';
import { contentPosToPx, resolveZone, WORLD_ORIGIN_PX, zoneBoxPx } from './zones.js';

/** Mirrors PX_PER_M in src/features/world/worldSpace.js. */
const PX_PER_M = 32;

/**
 * How far outside the destination's region a row may stand and still cross:
 * 6 m, ZONE_GATE_RANGE_PX's tolerance (world/travel.ts). The client sends at
 * 2 m inside the destination, and its row trails it by at most one claim plus
 * one round trip (~2.6 m at sprint), so an honest row is within ~0.6 m of the
 * region when the call lands. A row 6 m out is stale, and is refused.
 */
export const SEAM_RANGE_PX = 6 * PX_PER_M;

/** One accepted crossing per identity per second (the `seamCrossing` table). */
export const SEAM_CROSSING_MIN_INTERVAL_MICROS = 1_000_000n;

/** A position in the overworld layout frame, in metres. */
export interface LayoutPoint {
  x: number;
  z: number;
}

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

const shiftRect = (r: Rect, dx: number, dz: number): Rect =>
  ({ minX: r.minX + dx, maxX: r.maxX + dx, minZ: r.minZ + dz, maxZ: r.maxZ + dz });

/** Closed: a point on an edge is inside. */
const rectContains = (r: Rect, x: number, z: number): boolean =>
  x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

/** Euclidean distance from a point to a rectangle; 0 on or inside it. */
const distanceToRect = (r: Rect, x: number, z: number): number =>
  Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));

/** A zone's server box (world/zones.ts zoneBoxPx) in layout metres. */
function boxInLayout(zone: ZoneDef): Rect {
  const box = zoneBoxPx(zone);
  const toM = (px: number, origin: number) => (px - WORLD_ORIGIN_PX) / PX_PER_M - origin;
  return shiftRect(
    {
      minX: toM(box.minX, zone.originOffsetM.x),
      maxX: toM(box.maxX, zone.originOffsetM.x),
      minZ: toM(box.minY, zone.originOffsetM.z),
      maxZ: toM(box.maxY, zone.originOffsetM.z),
    },
    zone.layout!.offsetM.x,
    zone.layout!.offsetM.z,
  );
}

// Resolved once at module load, like resolveZone's boxes: the manifest is
// static for the life of a published module.
const LAYOUT_ZONES = ZONES.filter((z) => z.layout);
const BASE: ZoneDef | null = LAYOUT_ZONES.find((z) => !z.layout!.regionM) ?? null;
const REGIONS = LAYOUT_ZONES
  .filter((z) => z.layout!.regionM)
  .map((z) => ({
    zoneId: z.id,
    rect: shiftRect(z.layout!.regionM!, z.layout!.offsetM.x, z.layout!.offsetM.z),
  }));
const BASE_BOX: Rect | null = BASE ? boxInLayout(BASE) : null;

/**
 * STDB px of a row in `zoneId` → its layout position. null when the zone is
 * unknown or not part of the overworld.
 */
export function layoutOfPx(px: number, py: number, zoneId: number): LayoutPoint | null {
  const zone = ZONES_BY_ID[zoneId];
  if (!zone?.layout) return null;
  return {
    x: (px - WORLD_ORIGIN_PX) / PX_PER_M - zone.originOffsetM.x + zone.layout.offsetM.x,
    z: (py - WORLD_ORIGIN_PX) / PX_PER_M - zone.originOffsetM.z + zone.layout.offsetM.z,
  };
}

/** The zone that owns a layout point: the one whose region contains it, else the base. */
export function layoutZoneAt(layoutX: number, layoutZ: number): number | null {
  for (const region of REGIONS) {
    if (rectContains(region.rect, layoutX, layoutZ)) return region.zoneId;
  }
  return BASE ? BASE.id : null;
}

/** Is a layout point base territory: in the base's box and in no region? */
function isBaseGround(x: number, z: number): boolean {
  if (!BASE_BOX || !rectContains(BASE_BOX, x, z)) return false;
  return REGIONS.every((region) => !rectContains(region.rect, x, z));
}

/** How far past an edge the "outside neighbour" probe looks. */
const EDGE_PROBE_M = 1e-6;

/**
 * Metres from a layout point to the ground `zoneId` owns.
 *
 * - **A non-base zone:** the Euclidean distance to its region (0 inside).
 * - **The base:** 0 on base ground — outside every region and inside the
 *   base's box (outside the box, the distance to it). Inside a region it is
 *   the distance to that region's nearest edge whose outside neighbour is base
 *   ground; layout rule (g) makes every edge qualify today. So a zone-2 row at
 *   layout (0,172) is 2 m from the base, and one at (0,400) is 230 m.
 *
 * Infinity for a zone that is unknown or not in the overworld.
 */
export function distanceToRegion(point: LayoutPoint, zoneId: number): number {
  const zone = ZONES_BY_ID[zoneId];
  if (!zone?.layout) return Infinity;

  const own = REGIONS.find((r) => r.zoneId === zoneId);
  if (own) return distanceToRect(own.rect, point.x, point.z);

  if (!BASE || BASE.id !== zoneId || !BASE_BOX) return Infinity;
  const containing = REGIONS.find((r) => rectContains(r.rect, point.x, point.z));
  if (!containing) return distanceToRect(BASE_BOX, point.x, point.z);

  // Each edge with the point just past it, level with `point`.
  const { minX, maxX, minZ, maxZ } = containing.rect;
  const edges = [
    { d: point.x - minX, x: minX - EDGE_PROBE_M, z: point.z },
    { d: maxX - point.x, x: maxX + EDGE_PROBE_M, z: point.z },
    { d: point.z - minZ, x: point.x, z: minZ - EDGE_PROBE_M },
    { d: maxZ - point.z, x: point.x, z: maxZ + EDGE_PROBE_M },
  ];
  let best = Infinity;
  for (const edge of edges) {
    if (edge.d < best && isBaseGround(edge.x, edge.z)) best = edge.d;
  }
  return best;
}

/** Why a crossing was refused — named so tests can assert on the exact guard. */
export type SeamCrossingRejection =
  | 'dead'
  | 'movement-restricted'
  | 'indoors'
  | 'same-zone'
  | 'not-overworld'
  | 'out-of-range'
  | 'level-too-low'
  | 'too-soon'
  | 'bad-destination';

export type SeamCrossingOutcome =
  | { ok: true; zoneId: number; x: number; y: number }
  | { ok: false; reason: SeamCrossingRejection };

/** The subset of a `player` row the guards read: its stored px, never a client claim. */
export interface SeamCrossingRow {
  x: number;
  y: number;
  hp: number;
  deadUntil: bigint;
}

/**
 * Resolve a `crossZone(destZoneId)` call, in the reducer's guard order:
 *
 *   1. alive (hp / deadUntil), not stun- or root-blocked, and outdoors
 *      (`dungeonInstanceId == 0`) — what movePlayer and travelToZone require;
 *   2. a different zone, and both zones are in the overworld;
 *   3. the row's layout position is within SEAM_RANGE_PX of `dest`'s ground
 *      (`distanceToRegion`, base included);
 *   4. the caller's level clears `dest.levelBand[0]`, the floor travelToZone
 *      applies (D246) — floor only, so walking back to an earlier zone is
 *      always allowed;
 *   5. at least SEAM_CROSSING_MIN_INTERVAL_MICROS since the caller's last
 *      accepted crossing (`lastCrossAt` 0n = never), inclusive.
 *
 * On success returns the destination px for the same layout point
 * (`contentPosToPx(dest, layout − offset(dest))`), deliberately unclamped so
 * the layout position is identical. Accepting a row up to 6 m outside a
 * region's side or north edge can therefore land up to 6 m outside `dest`'s
 * box; `resolveZone` still assigns it to `dest` (server origins are ≥ 3000 m
 * apart) and the caller's next movePlayer claim, from inside the region, is
 * inside it. That zone is re-checked here rather than assumed.
 */
export function resolveSeamCrossing(
  row: SeamCrossingRow,
  rowZoneId: number,
  destZoneId: number,
  level: number,
  inDungeon: boolean,
  controlBlocked: boolean,
  lastCrossAt: bigint,
  now: bigint,
): SeamCrossingOutcome {
  if (row.hp <= 0 || row.deadUntil > now) return { ok: false, reason: 'dead' };
  if (controlBlocked) return { ok: false, reason: 'movement-restricted' };
  if (inDungeon) return { ok: false, reason: 'indoors' };
  if (destZoneId === rowZoneId) return { ok: false, reason: 'same-zone' };

  const dest = ZONES_BY_ID[destZoneId];
  const here = layoutOfPx(row.x, row.y, rowZoneId);
  if (!dest?.layout || !here) return { ok: false, reason: 'not-overworld' };

  if (distanceToRegion(here, dest.id) * PX_PER_M > SEAM_RANGE_PX) {
    return { ok: false, reason: 'out-of-range' };
  }
  if (level < dest.levelBand[0]) return { ok: false, reason: 'level-too-low' };
  if (lastCrossAt > 0n && now - lastCrossAt < SEAM_CROSSING_MIN_INTERVAL_MICROS) {
    return { ok: false, reason: 'too-soon' };
  }

  const px = contentPosToPx(dest.id, {
    x: here.x - dest.layout.offsetM.x,
    z: here.z - dest.layout.offsetM.z,
  });
  if (resolveZone(px.x, px.y).zoneId !== dest.id) return { ok: false, reason: 'bad-destination' };
  return { ok: true, zoneId: dest.id, x: px.x, y: px.y };
}

// ── table plumbing ──────────────────────────────────────────────────────────
//
// A narrow structural view of the private `seamCrossing` table, so the rate
// floor's read and stamp are testable against an in-memory fake. index.ts
// passes `ctx.db.seamCrossing` straight in.

/** `ctx.db.seamCrossing`, as far as these helpers use it. */
export interface SeamCrossingTableLike {
  identity: {
    find(identity: any): { identity: any; lastCrossAt: bigint } | null | undefined;
    update(row: { identity: any; lastCrossAt: bigint }): unknown;
  };
  insert(row: { identity: any; lastCrossAt: bigint }): unknown;
}

/** `seamCrossing.lastCrossAt` for `identity`, 0n when it has never crossed. */
export function lastSeamCrossAtFor(table: SeamCrossingTableLike, identity: any): bigint {
  return table.identity.find(identity)?.lastCrossAt ?? 0n;
}

/** Upsert `identity`'s rate-floor anchor to `now` after an accepted crossing. */
export function stampSeamCrossing(table: SeamCrossingTableLike, identity: any, now: bigint): void {
  const existing = table.identity.find(identity);
  if (existing) table.identity.update({ ...existing, lastCrossAt: now });
  else table.insert({ identity, lastCrossAt: now });
}
