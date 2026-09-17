// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/zones/zone2/npcs.ts
// Regenerate with: node scripts/sync_world_content.mjs

/**
 * zone2/npcs.ts — the Kestrel Hold garrison, Zone 2's first-pass NPC set.
 *
 * Deliberately thin (D162): Zone 2 ships its geography, its travel link and a
 * minimal content set in M10; content density comparable to Zone 1's (7 NPCs,
 * 14 camps, 15 landmarks) is M11's job, not this file's.
 *
 * Positions are zone-local metres, the same frame Zone 1 uses — the server
 * offsets them by ZoneDef.originOffsetM when it seeds rows
 * (spacetimedb/src/world/zones.ts, contentPosToPx). Zone 2's origin is 3000 m
 * east of Zone 1's, so (0,0) here is Kestrel Hold's valley floor, not Oakrest.
 *
 * questIds are empty on purpose: Zone 2 has no quest chain yet. A quest added
 * here must also be listed by its giver (validateContent enforces the back-link).
 */
import type { NpcDef } from '../../types';

export const NPCS: NpcDef[] = [
  {
    id: 'warden_kesk',
    zoneId: 2,
    name: 'Warden Kesk',
    title: 'Keeper of the South Pass',
    // Just inside the hold's south wall, off the gate road so the carriageway
    // stays clear (the road runs up x = 0 from the pass at z = -170).
    pos: { x: -9, z: -145 },
    facingRad: 0.4,
    questIds: [],
    greeting: 'You came up through the pass, $C? Then you already know the moor is worse.',
  },
  {
    id: 'quartermaster_ivet',
    zoneId: 2,
    name: 'Quartermaster Ivet',
    title: 'Hold Quartermaster',
    pos: { x: -21, z: -133 },
    facingRad: -2.3,
    questIds: [],
    greeting: 'Everything here is carried up the pass on someone\'s back, $N. Prices reflect it.',
    vendorItemIds: ['baked_bread', 'spring_water', 'roasted_boar'],
  },
  {
    id: 'scout_arren',
    zoneId: 2,
    name: 'Scout Arren',
    title: 'Moor Scout',
    pos: { x: -11, z: -124 },
    facingRad: 1.9,
    questIds: [],
    greeting: 'Three things move out there: stalkers, the raiders, and whatever the cairns let out.',
  },
];
