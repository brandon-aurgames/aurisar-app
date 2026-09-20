/**
 * zone2/npcs.ts — the Kestrel Hold garrison, Zone 2's NPC set.
 *
 * M10 (D162) shipped this deliberately thin (3 NPCs). M11-4 (D168 item 1)
 * brings it to the area-scaled parity target — ceil(Zone1's 7 x (360/520)^2)
 * = 4 — by adding one garrison NPC. Full 1:1 density with Zone 1 was never
 * the goal; D168 §1.1 is the area-normalization this target comes from.
 *
 * Positions are zone-local metres, the same frame Zone 1 uses — the server
 * offsets them by ZoneDef.originOffsetM when it seeds rows
 * (spacetimedb/src/world/zones.ts, contentPosToPx). Zone 2's origin is 3000 m
 * east of Zone 1's, so (0,0) here is Kestrel Hold's valley floor, not Oakrest.
 *
 * questIds are empty on purpose: Zone 2 has no quest chain yet (D167 defers
 * it to M12). A quest added here must also be listed by its giver
 * (validateContent enforces the back-link).
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
  {
    // The +1 NPC (D168 item 1). Placed with the rest of the garrison inside
    // the hold's south wall, clear of the carriageway and >=12m from the
    // other three (zone2.test.ts pins both).
    id: 'sergeant_talma',
    zoneId: 2,
    name: 'Sergeant Talma',
    title: 'Hold Sergeant',
    pos: { x: -35, z: -122 },
    facingRad: 2.6,
    questIds: [],
    greeting: "Bulls are trampling the south fences, the wights grow bolder by the week, and now "
      + "something's rallying the raiders under the scarp. Pick your direction, $C, and mind your back.",
  },
];
