/**
 * world/zones.ts — the px plane's zone map.
 *
 * One module owns the three things that used to be scattered and, in one
 * copy, already wrong:
 *
 *   1. Zone-local meters → STDB px. The same origin-offset arithmetic was
 *      written out three times (index.ts, dungeon/helpers.ts,
 *      vendors/helpers.ts). The dungeon copy read
 *      `const ox = zoneId === 1 ? 0 : 0;` — a literal no-op that returned zone
 *      1's origin for every zone, so a dungeon whose entrance sat in any other
 *      zone resolved to a px pair inside zone 1.
 *   2. Movement bounds. `movePlayer` clamped to ONE symmetric ±1000 m box
 *      around the origin (`WORLD_MIN_PX` / `WORLD_MAX_PX`, duplicated again in
 *      `buildCampfire`). Zones 2+ sit at k·3000 m offsets, i.e. entirely
 *      outside that box, so every player in one would have been yanked back to
 *      the boundary on their first move (D156).
 *   3. Which zone a px pair is in. `detectZone` answered this with four
 *      hardcoded pixel rectangles (hub / training / plaza / wilderness) that
 *      predate the content package's zones entirely and had no relationship to
 *      `ZoneDef.id` (D157).
 *
 * `resolveZone` is all three at once: given a px pair it returns the content
 * zone that owns it, whether it was inside that zone's playable box, and the
 * position clamped into it. Bounds and zone identity are the same question
 * asked from two call sites, so they get one answer.
 *
 * Deliberately NOT a widening of the old box. Widening one global rectangle to
 * span a k·3000 m offset would make the ~1000 m between two zones "in bounds"
 * while belonging to no zone; per-zone boxes leave that gap unclaimed, and a
 * claim landing in it is clamped back into the nearest zone rather than
 * silently accepted somewhere nothing can classify.
 *
 * Backward compatibility: with only zone 1 defined — the state that ships
 * today — the box this computes is identical to the retired constants
 * (min -30368, max 33568 on both axes), so no position the old clamp accepted
 * is rejected here. Pinned by src/features/world/__tests__/zoneBounds.test.js.
 */

import { ZONES, ZONES_BY_ID } from '../content/index.js';

/** Mirrors PX_PER_M in src/features/world/worldSpace.js. */
const PX_PER_M = 32;

/**
 * Px coordinate of world-space (0, 0). Mirrors WORLD_ORIGIN_PX in
 * src/features/world/worldSpace.js (client source of truth).
 */
export const WORLD_ORIGIN_PX = 1600;

/** 1 world unit of player half-width, held back from every zone edge. */
export const PLAYER_HALF_PX = 32;

/**
 * Half-width of a zone's playable box when `ZoneDef.boundsHalfExtentM` is not
 * set. 1000 m is exactly the legacy global clamp, so zone 1 — which does not
 * set it — keeps the bounds it shipped with.
 */
export const DEFAULT_ZONE_HALF_EXTENT_M = 1000;

/** The subset of `ZoneDef` this module needs; kept narrow so it is testable. */
export interface ZoneBoundsSource {
  id: number;
  originOffsetM: { x: number; z: number };
  boundsHalfExtentM?: number;
}

/** A zone's playable box, in STDB px, inclusive on both edges. */
export interface ZoneBoxPx {
  zoneId: number;
  centerX: number;
  centerY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Zone-local meters → STDB px. The one copy of this arithmetic; `seedWorld`
 * places NPC / spawn / waypoint rows with it, and every proximity gate that
 * compares a player row against content coordinates must use the same one or
 * the two disagree by the zone's whole origin offset.
 *
 * An unknown zone id falls back to the origin rather than throwing: reducers
 * must not abort a transaction over content that `validateContent` already
 * rejects at authoring time.
 */
export function contentPosToPx(
  zoneId: number,
  pos: { x: number; z: number },
): { x: number; y: number } {
  const zone = ZONES_BY_ID[zoneId];
  const ox = zone ? zone.originOffsetM.x : 0;
  const oz = zone ? zone.originOffsetM.z : 0;
  return {
    x: Math.round((pos.x + ox) * PX_PER_M + WORLD_ORIGIN_PX),
    y: Math.round((pos.z + oz) * PX_PER_M + WORLD_ORIGIN_PX),
  };
}

/** The px box a zone's players may occupy, derived from its content entry. */
export function zoneBoxPx(zone: ZoneBoundsSource): ZoneBoxPx {
  const centerX = zone.originOffsetM.x * PX_PER_M + WORLD_ORIGIN_PX;
  const centerY = zone.originOffsetM.z * PX_PER_M + WORLD_ORIGIN_PX;
  const halfExtentM =
    zone.boundsHalfExtentM !== undefined && zone.boundsHalfExtentM > 0
      ? zone.boundsHalfExtentM
      : DEFAULT_ZONE_HALF_EXTENT_M;
  const reachPx = halfExtentM * PX_PER_M - PLAYER_HALF_PX;
  return {
    zoneId: zone.id,
    centerX,
    centerY,
    minX: centerX - reachPx,
    maxX: centerX + reachPx,
    minY: centerY - reachPx,
    maxY: centerY + reachPx,
  };
}

export interface ZoneResolution {
  /** Content `ZoneDef.id` owning this position — the nearest zone when out of bounds. */
  zoneId: number;
  /** True when the input was already inside `zoneId`'s box. */
  inBounds: boolean;
  /** The input clamped into `zoneId`'s box; identical to the input when `inBounds`. */
  x: number;
  y: number;
}

/** No zone at all — only reachable if the content package ships zero zones. */
const NO_ZONE_ID = 0;

/**
 * Build a resolver over an explicit zone list. `resolveZone` below is this
 * bound to the live content manifest; the factory exists so tests can exercise
 * the multi-zone and offset-zone paths without inventing content.
 *
 * Boxes are computed once at construction — the resolver runs on the movement
 * hot path, at up to 25 Hz per player.
 */
export function makeZoneResolver(
  zones: readonly ZoneBoundsSource[],
): (px: number, py: number) => ZoneResolution {
  const boxes = zones.map(zoneBoxPx);

  return function resolve(px: number, py: number): ZoneResolution {
    if (boxes.length === 0) {
      return { zoneId: NO_ZONE_ID, inBounds: false, x: px, y: py };
    }

    // A non-finite claim compares false against every bound, so it would
    // otherwise read as "inside every box" and be written to the row as NaN.
    // Treat it as out of bounds at the first zone's centre: the speed guard
    // downstream then walks the row there at walking pace instead of storing
    // a coordinate no later comparison can reason about.
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      const fallback = boxes[0];
      return {
        zoneId: fallback.zoneId,
        inBounds: false,
        x: fallback.centerX,
        y: fallback.centerY,
      };
    }

    let nearest = boxes[0];
    let nearestDistSq = Infinity;

    for (const box of boxes) {
      // Distance from the point to the box: 0 on an axis the point already
      // sits within, so both being 0 means the point is inside the box.
      const dx = px < box.minX ? box.minX - px : px > box.maxX ? px - box.maxX : 0;
      const dy = py < box.minY ? box.minY - py : py > box.maxY ? py - box.maxY : 0;
      if (dx === 0 && dy === 0) {
        return { zoneId: box.zoneId, inBounds: true, x: px, y: py };
      }
      const distSq = dx * dx + dy * dy;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = box;
      }
    }

    return {
      zoneId: nearest.zoneId,
      inBounds: false,
      x: Math.max(nearest.minX, Math.min(nearest.maxX, px)),
      y: Math.max(nearest.minY, Math.min(nearest.maxY, py)),
    };
  };
}

/**
 * Resolve an STDB px pair against the live zone manifest.
 *
 * Clamp, never reject — the rule world/moveGuard.ts states for the speed
 * ceiling holds here for the same reason: movement is client-authoritative and
 * never reconciled, so a rejected move strands the stored row while the player
 * keeps walking. An out-of-bounds claim is dragged back to the nearest edge of
 * the zone it is closest to, which is what the retired global clamp did for
 * zone 1 and now does for every zone.
 */
export const resolveZone = makeZoneResolver(ZONES);
