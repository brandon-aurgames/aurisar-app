// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/zones/manifest.ts
// Regenerate with: node scripts/sync_world_content.mjs

/**
 * zones/manifest.ts — the zone progression map.
 *
 * Zone 1 is a NEW map (reference-style hub + camps + roads) — its
 * worldgen config (zone1_world.json) lands in P1. Ashwood is intentionally
 * NOT in this manifest: it stays in the repo as a dev/test world only.
 * Level bands cap at 35 until more zones ship (plan §2b). All names are
 * placeholders for the story pass.
 *
 * This manifest is also the server's bounds table: world/zones.ts derives each
 * zone's playable px box from `originOffsetM` + `boundsHalfExtentM` (D156), and
 * `validateContent` rejects two boxes that overlap. Moving a zone's origin or
 * extent therefore changes what `movePlayer` accepts — it is not cosmetic data.
 */
import type { ZoneDef } from '../types';
import { LANDMARKS as L } from './zone1/landmarks.generated';

export const ZONES: ZoneDef[] = [
  {
    id: 1,
    key: 'zone1',
    // Modeled on the reference design's starter zone. The display name is
    // a working placeholder the story pass renames.
    name: 'Zone One',
    levelBand: [1, 7],
    // Zone 1 lives at the world origin (it replaces Ashwood in place). It
    // deliberately does NOT set boundsHalfExtentM: the 1000 m default is
    // exactly the global clamp zone 1 shipped with, so its accept region is
    // unchanged by the move to per-zone bounds (pinned by zoneBounds.test.js).
    originOffsetM: { x: 0, z: 0 },
    worldConfig: 'zone1_world.json',
    // NOTE: neither of these is read by anything yet — the server hardcodes
    // the spawn at STDB (1600,1600) and respawn snaps to the origin. They are
    // still pointed at the landmarks so that when the graveyard build-out
    // wires them up, they cannot already have drifted.
    spawnPos: { x: L.hub.x, z: L.hub.z },
    graveyardPos: { x: L.graveyard.x, z: L.graveyard.z },
    gates: [
      // Zone 2 begins past z=180; the pass placement follows the reference
      // northern ridge road.
      { id: 'z1_north_pass', pos: { x: 0, z: 170 }, toZoneId: 2, toGateId: 'z2_south_pass' },
    ],
  },
  {
    id: 2,
    key: 'zone2',
    // Working placeholder, same convention as Zone One.
    name: 'Zone Two',
    // Continues zone 1's [1,7] band at its own top end — the boundary level is
    // shared by both zones, which is how the band list is meant to read (a
    // level-7 player belongs in either). Zone 2's authored content currently
    // tops out at L12; the band's remaining headroom is M11's to fill.
    levelBand: [7, 14],
    // The k·3000 m offset this file has promised since P1: zone 2 is an offset
    // region on the same px plane, not a contiguous extension of zone 1 (D155).
    // 3000 m → STDB px 97600, the number zoneBounds.test.js pins.
    originOffsetM: { x: 3000, z: 0 },
    // Zone 2 is a smaller region than zone 1 (a 360 m playable disc against
    // zone 1's 520 m), so it claims a smaller box rather than inheriting the
    // 1000 m default. 400 m contains the whole disc with margin and leaves a
    // wide unclaimed gap between the two zones, which resolveZone clamps into
    // the nearer zone instead of accepting as valid ground.
    boundsHalfExtentM: 400,
    worldConfig: 'zone2_world.json',
    // As with zone 1, nothing reads these yet — travelToZone (M10-11) is the
    // reducer that will. Pointed at Kestrel Hold and its burial ground so they
    // cannot drift before then; both mirror zone2_world.json's `anchors`.
    spawnPos: { x: 0, z: -120 },
    graveyardPos: { x: -26, z: -150 },
    gates: [
      // The other half of z1_north_pass. The two gates are each other's only
      // link, and validateContent now checks the back-link for real rather
      // than tolerating it as dangling.
      { id: 'z2_south_pass', pos: { x: 0, z: -170 }, toZoneId: 1, toGateId: 'z1_north_pass' },
    ],
  },
  // Zone 3 (levels 14–35) lands later; see WORLD-PLAN.md.
];

export const ZONES_BY_ID: Record<number, ZoneDef> = Object.fromEntries(
  ZONES.map((z) => [z.id, z]),
);

export function getZone(id: number): ZoneDef | null {
  return ZONES_BY_ID[id] ?? null;
}
