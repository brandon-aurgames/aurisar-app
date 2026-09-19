// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/zones/zone2/landmarks.generated.ts
// Regenerate with: node scripts/sync_world_content.mjs

// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/config/zone2_world.json (anchors) + D169 (Barrowdeep gate offset)
// Regenerate with: node scripts/emit_zone_landmarks.mjs

/**
 * Shared Zone 2 world positions — the single authored copy.
 *
 * Anything that needs a landmark's coordinates (waypoints, NPCs, mob camps,
 * props, dungeon entrances, the map) reads it from here rather than repeating
 * the literal. Derived entries trace back to the terrain/dungeon truth that
 * already owned them; authored entries live in zone2_world.json `anchors`.
 */
export interface LandmarkDef {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
}

export const LANDMARKS = {
  // zone2_world.json anchors
  barrowdeep: { id: 'barrowdeep', name: "The Barrowdeep", x: 125, z: -30 },
  // zone2_world.json anchors.barrowdeep, offset by D169's mound halfW + approach margin (mirrors castlePlan.js ENTRY.gateWorld's derivation)
  barrowdeep_gate: { id: 'barrowdeep_gate', name: "The Barrowdeep Gate", x: 101.5, z: -30 },
  // zone2_world.json lake (bowl center)
  blackmere: { id: 'blackmere', name: "Blackmere", x: -120, z: 40 },
  // zone2_world.json anchors
  cairnfield: { id: 'cairnfield', name: "Cairnfield", x: 60, z: 10 },
  // zone2_world.json anchors
  hollowmoor: { id: 'hollowmoor', name: "Hollowmoor", x: -70, z: -40 },
  // zone2_world.json anchors
  kestrel_hold: { id: 'kestrel_hold', name: "Kestrel Hold", x: 0, z: -120 },
  // zone2_world.json anchors
  kestrel_rest: { id: 'kestrel_rest', name: "Kestrel Rest", x: -26, z: -150 },
  // zone2_world.json anchors
  south_pass: { id: 'south_pass', name: "The South Pass", x: 0, z: -170 },
  // zone2_world.json anchors
  windward_scarp: { id: 'windward_scarp', name: "Windward Scarp", x: -20, z: 80 },
  // zone2_world.json plateaus[4] (summit shelf)
  windward_scarp_summit: { id: 'windward_scarp_summit', name: "Windward Scarp Summit", x: 152, z: 178 },
  // zone2_world.json zones.wildwood
  z2_wildwood: { id: 'z2_wildwood', name: "The Wildwood", x: -46, z: 140 },
} as const satisfies Record<string, LandmarkDef>;

export type LandmarkId = keyof typeof LANDMARKS;

/** All landmarks as a flat array (stable id order). */
export const ALL_LANDMARKS: readonly LandmarkDef[] = Object.values(LANDMARKS);

/** Position-only helper for the common `{ x, z }` shape. */
export function landmarkPos(id: LandmarkId): { x: number; z: number } {
  const l = LANDMARKS[id];
  return { x: l.x, z: l.z };
}
