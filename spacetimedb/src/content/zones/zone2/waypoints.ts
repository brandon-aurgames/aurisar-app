// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/zones/zone2/waypoints.ts
// Regenerate with: node scripts/sync_world_content.mjs

/**
 * zone2/waypoints.ts — Zone 2's points of interest.
 *
 * Positions come from LANDMARKS (generated — see scripts/emit_zone_landmarks.mjs)
 * so a POI label can never drift from the terrain feature it names — the same
 * guarantee zone1/waypoints.ts has had since its own emitter shipped. Zone 2
 * used to author these as literals (its own emitter was Zone-1-only, and
 * zone2.test.ts asserted each one against its raw `anchors` entry instead);
 * M11-3 (D177) generated Zone 2's landmark table and switched this file over,
 * exactly as this header used to ask for. Only `radiusM` is authored here:
 * the POI radius is a map/label concern, not a world-geometry one.
 */
import type { WaypointDef } from '../../types';
import { LANDMARKS as L } from './landmarks.generated';

export const WAYPOINTS: WaypointDef[] = [
  { id: 'poi_kestrel_hold',   zoneId: 2, pos: { x: L.kestrel_hold.x, z: L.kestrel_hold.z },     radiusM: 24, label: L.kestrel_hold.name },
  { id: 'poi_hollowmoor',     zoneId: 2, pos: { x: L.hollowmoor.x, z: L.hollowmoor.z },         radiusM: 22, label: L.hollowmoor.name },
  { id: 'poi_cairnfield',     zoneId: 2, pos: { x: L.cairnfield.x, z: L.cairnfield.z },         radiusM: 20, label: L.cairnfield.name },
  { id: 'poi_windward_scarp', zoneId: 2, pos: { x: L.windward_scarp.x, z: L.windward_scarp.z }, radiusM: 20, label: L.windward_scarp.name },
  // Sits on the derived gate (the actual walk-up point), labeled with the
  // site's own name — mirrors zone1/waypoints.ts's poi_castle_ashwood, which
  // sits on `castle_gate` but is labeled with `castle_ashwood`'s name.
  { id: 'poi_barrowdeep',     zoneId: 2, pos: { x: L.barrowdeep_gate.x, z: L.barrowdeep_gate.z }, radiusM: 12, label: L.barrowdeep.name },
];
