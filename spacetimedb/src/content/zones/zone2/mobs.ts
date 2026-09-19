// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/zones/zone2/mobs.ts
// Regenerate with: node scripts/sync_world_content.mjs

/**
 * zone2/mobs.ts — Zone 2's mob roster and camp spawns.
 *
 * M10 (D162) shipped 3 mob types / 3 camps as a thin first pass. M11-4
 * (D168 items 2-3) brings this to the area-scaled parity target: 6 overworld
 * mob types and 7 camps (5 regular + 2 named elites at count:1), mirroring
 * Zone 1's own 14-camps-over-11-types / ~29%-elite mix at Zone 2's smaller
 * scale. The 3 new types land at L7 (regular) / L11 + L14 (elites) so the
 * band reads 7,8,10,11,12,13,14 with no hole once the Barrowdeep's L13 boss
 * (a separate, not-yet-built dungeon — D169/D170, M11-5) is counted in.
 *
 * Stats continue ZONE 2's OWN authored curve, not Zone 1's — D168's own
 * correction, restated here because it is easy to get backwards: `maxHp =
 * 26*level + 4` is an EXACT fit for all of Zone 2's regular mobs (moor_stalker
 * 212, cairn_wight 264, frostbound_raider 316, and now moor_bull 186), but it
 * is only ever an "≈" for Zone 1's — 4 of Zone 1's 15 shipped mobs miss it
 * outright. Do not assert this formula against Zone 1's roster; zone2.test.ts
 * pins it against Zone 2's own regular mobs only. `dmgMin ≈ 3*level - 1`
 * remains an approximation everywhere, elites included. Elites (Zone 1
 * precedent: old_greyjaw 1.76x, rutfang 1.72x, chitter_queen 1.75x,
 * serah_the_knife 1.64x over the SAME curve at their own level) break the HP
 * line at a measured 1.64-1.76x; the two new Zone 2 elites both use 1.70x,
 * pinned exactly in zone2.test.ts. Loot draws only on items that already
 * exist in the catalog (items/zone1.ts) — Zone 2 adds no items in this pass,
 * so the two new elites improve the odds on an existing family's drop pool
 * rather than getting a new named trophy.
 *
 * glbKey must resolve in public/assets/manifest/mobs.manifest.json
 * (assetManifests.test.js gates this globally; zone2.test.ts also checks it
 * locally by reading the manifest file directly, not a hardcoded list). Every
 * new mob here reuses one of the 8 existing silhouettes — D172's reuse rule,
 * the same one D159 applies to terrain layers, extended to the Barrowdeep.
 */
import type { MobDef, SpawnDef } from '../../types';

export const MOBS: MobDef[] = [
  {
    mobType: 'moor_stalker',
    name: 'Moor Stalker',
    family: 'beast',
    level: 8,
    maxHp: 212,
    dmgMin: 23,
    dmgMax: 26,
    attackSpeedSec: 1.9,
    moveSpeedMps: 4.6,
    aggroRadiusM: 11,
    leashRadiusM: 38,
    respawnSec: 45,
    glbKey: 'wolf',
    social: true,
    lootTable: [
      { itemId: 'wolf_fang', chance: 0.5, min: 1, max: 1 },
      { itemId: 'linen_scrap', chance: 0.25, min: 1, max: 1 },
    ],
    copperMin: 40,
    copperMax: 40,
  },
  {
    mobType: 'cairn_wight',
    name: 'Cairn Wight',
    family: 'undead',
    level: 10,
    maxHp: 264,
    dmgMin: 29,
    dmgMax: 32,
    attackSpeedSec: 2.3,
    moveSpeedMps: 3.6,
    aggroRadiusM: 12,
    leashRadiusM: 36,
    respawnSec: 60,
    glbKey: 'skeleton_minion',
    lootTable: [
      { itemId: 'bone_fragments', chance: 0.6, min: 1, max: 2 },
      { itemId: 'ghostly_essence', chance: 0.55, min: 1, max: 1 },
    ],
    copperMin: 52,
    copperMax: 52,
  },
  {
    mobType: 'frostbound_raider',
    name: 'Frostbound Raider',
    family: 'humanoid',
    level: 12,
    maxHp: 316,
    dmgMin: 35,
    dmgMax: 38,
    attackSpeedSec: 2.0,
    moveSpeedMps: 4.0,
    aggroRadiusM: 12,
    leashRadiusM: 42,
    respawnSec: 60,
    glbKey: 'tribal',
    social: true,
    lootTable: [
      { itemId: 'bandit_bandana', chance: 0.5, min: 1, max: 1 },
      { itemId: 'linen_scrap', chance: 0.35, min: 1, max: 1 },
    ],
    copperMin: 64,
    copperMax: 64,
  },
  {
    // The new regular type (D168 item 2), L7 — the bottom of Zone 2's band,
    // grazing the vale floor around Kestrel Rest. glbKey 'bull' is unused
    // elsewhere in Zone 2, so this also widens Zone 2's silhouette variety
    // (D172 reuse rule: an existing manifest key, just not one already spoken
    // for here).
    mobType: 'moor_bull',
    name: 'Moor Bull',
    family: 'beast',
    level: 7,
    maxHp: 186, // 26*7+4, Zone 2's own exact curve
    dmgMin: 20, // 3*7-1
    dmgMax: 23,
    attackSpeedSec: 2.2,
    moveSpeedMps: 5.0,
    aggroRadiusM: 10,
    leashRadiusM: 36,
    respawnSec: 45,
    glbKey: 'bull',
    social: true,
    lootTable: [
      { itemId: 'linen_scrap', chance: 0.3, min: 1, max: 1 },
    ],
    copperMin: 35,
    copperMax: 35,
  },
  {
    // Elite #1 (D168 item 2/3), L11. Reuses cairn_wight's family + glbKey —
    // the same "elite is a bigger version of the thing already camped at this
    // POI" pattern as Zone 1's old_greyjaw/rutfang (wolf) and chitter_queen
    // (spider): a bigger threat guarding the approach to the barrows proper,
    // not a new silhouette.
    mobType: 'barrow_revenant',
    name: 'Barrow Revenant',
    family: 'undead',
    level: 11,
    maxHp: 493, // round(1.70 * (26*11+4)) = round(1.70*290) — elite multiplier, pinned in zone2.test.ts
    dmgMin: 32, // 3*11-1
    dmgMax: 36,
    attackSpeedSec: 2.2,
    moveSpeedMps: 3.8,
    aggroRadiusM: 14,
    leashRadiusM: 40,
    respawnSec: 240,
    glbKey: 'skeleton_minion',
    lootTable: [
      { itemId: 'bone_fragments', chance: 0.6, min: 1, max: 2 },
      { itemId: 'ghostly_essence', chance: 0.65, min: 1, max: 1 },
    ],
    copperMin: 150,
    copperMax: 150,
  },
  {
    // Elite #2 (D168 item 2/3), L14 — the top of Zone 2's band. Reuses
    // frostbound_raider's family + glbKey, same pattern as above.
    mobType: 'frostbound_warlord',
    name: 'Frostbound Warlord',
    family: 'humanoid',
    level: 14,
    maxHp: 626, // round(1.70 * (26*14+4)) = round(1.70*368) — same elite multiplier
    dmgMin: 41, // 3*14-1
    dmgMax: 45,
    attackSpeedSec: 1.9,
    moveSpeedMps: 4.2,
    aggroRadiusM: 14,
    leashRadiusM: 46,
    respawnSec: 240,
    glbKey: 'tribal',
    lootTable: [
      { itemId: 'bandit_bandana', chance: 0.6, min: 1, max: 1 },
      { itemId: 'linen_scrap', chance: 0.45, min: 1, max: 1 },
    ],
    copperMin: 200,
    copperMax: 200,
  },
];

/**
 * Camps. M10 (D162) authored these as "one per POI" for its original 3, and
 * that read fine at 3 camps / 4 POIs (waypoints.ts). D168's parity fill takes
 * Zone 2 to 7 camps against a POI count M11-4 does not own (waypoints.ts /
 * the future landmarks table are M11-3's, blocked on this task) — at 7-and-4
 * a strict one-per-POI bijection cannot hold, which is exactly R17's finding.
 *
 * R17 resolution: relax to Zone 1's OWN actual invariant, not Zone 2's
 * stricter former one. Zone 1 runs 14 camps over 9 POIs (many camps per
 * landmark, several landmarks with none) and its real rule — the one
 * landmarks.test.ts pins — is "every camp sits within reach (40m) of SOME
 * named landmark", not "every camp sits exactly on a POI's own coordinates".
 * Zone 2 has no generated landmark table yet (that is M11-3's job, per this
 * file's own prior note), so `zone2_world.json`'s `anchors` map stands in for
 * that broader landmark set here — it already plays the same role (a superset
 * of the POI list: south_pass/graveyard/barrowdeep are anchors with no POI of
 * their own, same shape as Zone 1's castle_gate/hollow_crypt/frostspire_summit).
 * zone2.test.ts now pins camps against "within 40m of the nearest anchor",
 * verified against every camp below, not against a bijection with POIs.
 *
 * Positions are authored as literals rather than as landmark offsets (same
 * reason as before: no generated table yet), each placed within reach of the
 * anchor named in its own comment.
 */
export const SPAWNS: SpawnDef[] = [
  // Hollowmoor (west) — the open moor the hold's west road runs out to.
  { netId: 'z2_stalkers', mobType: 'moor_stalker',     zoneId: 2, pos: { x: -70, z: -40 }, count: 6, radiusM: 20 },
  // Cairnfield (east) — barrow ground at the end of the east road.
  { netId: 'z2_wights',   mobType: 'cairn_wight',      zoneId: 2, pos: { x: 60, z: 10 },   count: 5, radiusM: 18 },
  // Windward Scarp (north) — off-road raider turf under the scarp.
  { netId: 'z2_raiders',  mobType: 'frostbound_raider', zoneId: 2, pos: { x: -20, z: 80 }, count: 5, radiusM: 18 },
  // A second Hollowmoor pack (D168's "one existing type gets a second camp"),
  // 25m NE of the first — same anchor, same pattern as Zone 1's
  // z1_wolves_a/z1_wolves_b two-pack Greywood Run.
  { netId: 'z2_stalkers_b', mobType: 'moor_stalker', zoneId: 2, pos: { x: -58, z: -18 }, count: 5, radiusM: 18 },
  // Near Kestrel Rest (the graveyard anchor) — the new regular type's camp.
  { netId: 'z2_bulls', mobType: 'moor_bull', zoneId: 2, pos: { x: -46, z: -150 }, count: 6, radiusM: 20 },
  // Between the wight camp and the Barrowdeep gate — 20m from z2_wights,
  // clear of the barrow's own exclusion disc (r=26, >26m away).
  { netId: 'z2_revenant', mobType: 'barrow_revenant', zoneId: 2, pos: { x: 76, z: -2 }, count: 1, radiusM: 5 },
  // South of the raider camp, toward the hold — a warlord pressing the raid
  // further than the regular pack alone has.
  { netId: 'z2_warlord', mobType: 'frostbound_warlord', zoneId: 2, pos: { x: -8, z: 64 }, count: 1, radiusM: 5 },
];
