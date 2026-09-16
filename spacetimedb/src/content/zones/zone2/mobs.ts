// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/zones/zone2/mobs.ts
// Regenerate with: node scripts/sync_world_content.mjs

/**
 * zone2/mobs.ts — Zone 2's mob roster and camp spawns.
 *
 * Three mob types, three camps (D162: a thin first pass; Zone 1's own dozen-plus
 * camps are the M11 target, not this file's).
 *
 * Stats continue Zone 1's authored curve rather than inventing a second one:
 * Zone 1 runs maxHp ≈ 26·level + 4 and dmgMin ≈ 3·level - 1 with a 3-point
 * spread (L2 56hp/5-8 … L6 160hp/18-21), so the L8/L10/L12 rows below are that
 * same line extended across Zone 2's [7,14] band. Loot draws only on items that
 * already exist in the catalog — Zone 2 adds no items in this pass.
 *
 * glbKey must resolve in public/assets/manifest/mobs.manifest.json
 * (assetManifests.test.js gates this); Zone 2 reuses Zone 1's silhouettes, the
 * same reuse-not-rebuild rule D159 applies to terrain layers.
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
];

/**
 * Camps. One per POI (zone2/waypoints.ts), so every camp has a map label a
 * breadcrumb can point at — the rule landmarks.test.ts pins for Zone 1.
 *
 * Positions are authored as literals rather than as landmark offsets: Zone 2
 * has no generated landmark table yet (scripts/emit_zone1_landmarks.mjs is
 * Zone-1-only, and parameterizing it is not in this task's scope). zone2.test.ts
 * pins them against zone2_world.json's `anchors` instead, which is the same
 * no-drift guarantee from the other direction.
 */
export const SPAWNS: SpawnDef[] = [
  // Hollowmoor (west) — the open moor the hold's west road runs out to.
  { netId: 'z2_stalkers', mobType: 'moor_stalker',     zoneId: 2, pos: { x: -70, z: -40 }, count: 6, radiusM: 20 },
  // Cairnfield (east) — barrow ground at the end of the east road.
  { netId: 'z2_wights',   mobType: 'cairn_wight',      zoneId: 2, pos: { x: 60, z: 10 },   count: 5, radiusM: 18 },
  // Windward Scarp (north) — off-road raider turf under the scarp.
  { netId: 'z2_raiders',  mobType: 'frostbound_raider', zoneId: 2, pos: { x: -20, z: 80 }, count: 5, radiusM: 18 },
];
