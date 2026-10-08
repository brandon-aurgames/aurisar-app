// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/zones/zone2/quests.ts
// Regenerate with: node scripts/sync_world_content.mjs

/**
 * Zone 2's linear Kestrel Hold chain (D206-D208). Placeholder story copy.
 * Levels come from fitness; authored gameXp remains gated by GAME_XP_ENABLED.
 */
import type { QuestDef } from '../../types';

export const QUESTS: QuestDef[] = [
  {
    id: 'q_z2_up_from_the_pass', zoneId: 2, name: 'Up from the Pass',
    giverNpcId: 'warden_kesk', turnInNpcId: 'scout_arren',
    text: 'Welcome to Kestrel Hold, $N. Step inside the walls and report to Scout Arren in the hold yard. He will tell you what waits beyond our fences.',
    completionText: 'Kesk sent you? Good. Sergeant Talma needs help with the bulls along the south fences.',
    objectives: [{ type: 'find', targetId: 'poi_kestrel_hold', label: 'Reach Kestrel Hold' }],
    reward: { copper: 80, gameXp: 400 },
  },
  {
    id: 'q_z2_trampled_fences', zoneId: 2, name: 'Trampled Fences',
    giverNpcId: 'sergeant_talma', turnInNpcId: 'sergeant_talma',
    requiresQuestId: 'q_z2_up_from_the_pass', minLevel: 7,
    text: 'The moor bulls have flattened another stretch of fence southwest of the hold. Slay 6 Moor Bulls before we lose the whole grazing ground, $N.',
    completionText: 'That will give the fence crew room to work. Ivet has a job for you when you are ready.',
    objectives: [{ type: 'kill', mobType: 'moor_bull', count: 6, label: 'Moor Bull slain' }],
    reward: { copper: 280, itemIds: ['stew'], gameXp: 600 },
  },
  {
    id: 'q_z2_stalker_pelts', zoneId: 2, name: 'Hides for the Hold',
    giverNpcId: 'quartermaster_ivet', turnInNpcId: 'quartermaster_ivet',
    requiresQuestId: 'q_z2_trampled_fences', minLevel: 8,
    text: 'The night watch needs warm hides. Hunt the Moor Stalkers around Hollowmoor and bring me 6 Moor Stalker Pelts. Both packs have the thick coats we need.',
    completionText: 'Six sound pelts. The watch will thank you when the frost comes. Arren has been asking after you.',
    objectives: [{ type: 'collect', itemId: 'stalker_pelt', count: 6, label: 'Moor Stalker Pelt' }],
    reward: { copper: 320, itemIds: ['stew'], gameXp: 750 },
  },
  {
    id: 'q_z2_what_the_cairns_let_out', zoneId: 2, name: 'What the Cairns Let Out',
    giverNpcId: 'scout_arren', turnInNpcId: 'scout_arren',
    requiresQuestId: 'q_z2_stalker_pelts', minLevel: 9,
    text: 'Something is moving among the stones east of Hollowmoor. Reach Cairnfield and look for signs of opened graves, then return to me. Keep clear of the dead for now, $N.',
    completionText: 'Broken seals and fresh tracks. Then the old stories were warnings after all.',
    objectives: [{ type: 'find', targetId: 'poi_cairnfield', label: 'Scout Cairnfield' }],
    // Section 2.1 requires non-decreasing copper; keep Q4 level with Q3.
    reward: { copper: 320, itemIds: ['stew'], gameXp: 850 },
  },
  {
    id: 'q_z2_lay_the_wights', zoneId: 2, name: 'Lay the Wights',
    giverNpcId: 'scout_arren', turnInNpcId: 'scout_arren',
    requiresQuestId: 'q_z2_what_the_cairns_let_out', minLevel: 10,
    text: 'The Cairn Wights are straying farther from their graves. Lay 8 of them to rest before they find the hold road. Watch the stones; they do not stay quiet for long.',
    completionText: 'The road is quieter. But Kesk fears something stronger is calling them out.',
    objectives: [{ type: 'kill', mobType: 'cairn_wight', count: 8, label: 'Cairn Wight laid to rest' }],
    reward: { copper: 380, itemIds: ['stew'], gameXp: 1000 },
  },
  {
    id: 'q_z2_the_barrow_revenant', zoneId: 2, name: 'The Barrow Revenant',
    giverNpcId: 'warden_kesk', turnInNpcId: 'warden_kesk',
    requiresQuestId: 'q_z2_lay_the_wights', minLevel: 11,
    text: 'Arren saw a Barrow Revenant east of Cairnfield. It walks alone, but the lesser dead heed its call. Destroy that revenant, $N, before another grave opens.',
    completionText: 'One voice silenced. Talma reports raiders gathering under the scarp; we cannot leave our flank open.',
    objectives: [{ type: 'kill', mobType: 'barrow_revenant', count: 1, spawnNetIdPrefix: 'z2_revenant', label: 'The Barrow Revenant slain' }],
    reward: { copper: 450, itemIds: ['stew'], gameXp: 1150 },
  },
  {
    id: 'q_z2_under_the_scarp', zoneId: 2, name: 'Under the Scarp',
    giverNpcId: 'sergeant_talma', turnInNpcId: 'sergeant_talma',
    requiresQuestId: 'q_z2_the_barrow_revenant', minLevel: 12,
    text: 'Frostbound Raiders are massing beneath Windward Scarp to the north. Slay 6 of them and break their advance. Leave their warlord alone; we need the road clear, not a glorious funeral.',
    completionText: 'Their advance is broken. Report to Kesk. He means to strike at the source beneath the cairns.',
    objectives: [{ type: 'kill', mobType: 'frostbound_raider', count: 6, label: 'Frostbound Raider slain' }],
    reward: { copper: 480, itemIds: ['stew'], gameXp: 1250 },
  },
  {
    id: 'q_z2_into_the_barrowdeep', zoneId: 2, name: 'Into the Barrowdeep',
    giverNpcId: 'warden_kesk', turnInNpcId: 'warden_kesk',
    requiresQuestId: 'q_z2_under_the_scarp', minLevel: 12,
    text: 'Find the Barrowdeep gate east of the hold, then descend into the tomb. The Cairn Thane rules those halls. End him within his cairn and return to me, $N. Let the dead finally keep their silence.',
    completionText: 'The Thane has fallen. Kestrel Hold can face the winter with its roads open and its dead at rest. Take this with our thanks.',
    objectives: [
      { type: 'find', targetId: 'poi_barrowdeep', label: 'Reach the Barrowdeep' },
      { type: 'kill', mobType: 'cairn_thane', count: 1, spawnNetIdPrefix: 'bd_boss', label: 'Cairn Thane slain in the Barrowdeep' },
    ],
    reward: { copper: 750, itemIds: ['militia_vest'], gameXp: 1400 },
  },
];
