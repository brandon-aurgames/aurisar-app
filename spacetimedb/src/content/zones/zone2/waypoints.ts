// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/zones/zone2/waypoints.ts
// Regenerate with: node scripts/sync_world_content.mjs

/**
 * zone2/waypoints.ts — Zone 2's points of interest: the hold plus one label per
 * camp, so no camp is somewhere the map cannot name.
 *
 * Zone 1's POIs read their positions out of landmarks.generated.ts so a label
 * can never drift from the terrain feature it names. Zone 2 has no generated
 * landmark table yet (the emitter is Zone-1-only), so these are literals — and
 * zone2.test.ts asserts each one still equals its `anchors` entry in
 * zone2_world.json, which is the same drift guard by other means. When M11
 * generates Zone 2 landmarks, these should switch to reading from them.
 */
import type { WaypointDef } from '../../types';

export const WAYPOINTS: WaypointDef[] = [
  { id: 'poi_kestrel_hold',  zoneId: 2, pos: { x: 0, z: -120 },  radiusM: 24, label: 'Kestrel Hold' },
  { id: 'poi_hollowmoor',    zoneId: 2, pos: { x: -70, z: -40 }, radiusM: 22, label: 'Hollowmoor' },
  { id: 'poi_cairnfield',    zoneId: 2, pos: { x: 60, z: 10 },   radiusM: 20, label: 'Cairnfield' },
  { id: 'poi_windward_scarp', zoneId: 2, pos: { x: -20, z: 80 }, radiusM: 20, label: 'Windward Scarp' },
];
