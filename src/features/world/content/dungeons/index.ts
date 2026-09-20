/**
 * dungeons/index.ts — instanced dungeon definitions.
 *
 * castle_ashwood is the v1 registration for Castle Ashwood
 * (src/features/world/castle/). The client renders the castle procedurally
 * from castlePlan.js; this entry is the SEAM:dungeon-def hook the server
 * seeder consumes in v2 to spawn interior mobs and gate 5-player groups.
 * Spawn positions are interior-local meters (castlePlan LOCAL space).
 *
 * barrowdeep is Zone 2's dungeon (D169-D172/D175, M11-5), authored the same
 * way from src/features/world/barrowdeep/barrowdeepPlan.js. Its `pos` values
 * are interior-local to ITS OWN anchor, which is zone-local to zone 2 — the
 * server resolves both through contentPosToPx(entrance.zoneId, ...), so a
 * consumer must never fold a dungeon's interior-local metres against zone 1's
 * origin (D173 item 2).
 */
import type { DungeonDef } from '../types';
import { CASTLE_ASHWOOD_ENTRY, CASTLE_ASHWOOD_SPAWNS } from './castleAshwood.generated.js';
import { BARROWDEEP_ENTRY, BARROWDEEP_SPAWNS } from './barrowdeep.generated.js';

export const DUNGEONS: DungeonDef[] = [
  {
    id: 'castle_ashwood',
    name: 'Castle Ashwood',
    minLevel: 5,
    entrance: { zoneId: 1, pos: { x: CASTLE_ASHWOOD_ENTRY.gateWorld.x, z: CASTLE_ASHWOOD_ENTRY.gateWorld.z } },
    layoutManifest: 'castle_ashwood.json',
    bossMobType: 'gorrak',
    bossMechanics: {
      aoePulse: { everySec: 9, damage: 14, radiusM: 6 },
      enrage: { afterSec: 240, mult: 1.5 },
    },
    spawns: CASTLE_ASHWOOD_SPAWNS.map(({ netId, mobType, pos, count, radiusM }) => ({
      netId,
      mobType,
      pos: { x: pos.x, z: pos.z },
      count,
      radiusM,
    })),
  },
  {
    // ── The Barrowdeep (Zone 2) ─────────────────────────────────────────────
    // minLevel 12 and a L13 boss are D170's rule applied, not assumed: a
    // dungeon sits at the TOP of its OWN zone's band, not above it. Castle
    // Ashwood is minLevel 5 inside zone 1's [1,7] (band.max - 2) with a L6
    // boss (band.max - 1); zone 2's band is [7,14], so the same relationship
    // gives 12 and 13. Pinned against the live manifest in
    // barrowdeepPlan.test.js so a later band edit cannot silently orphan it.
    id: 'barrowdeep',
    name: 'The Barrowdeep',
    minLevel: 12,
    entrance: { zoneId: 2, pos: { x: BARROWDEEP_ENTRY.gateWorld.x, z: BARROWDEEP_ENTRY.gateWorld.z } },
    layoutManifest: 'barrowdeep.json',
    bossMobType: 'cairn_thane',
    bossMechanics: {
      // DERIVED from Castle Ashwood's own values, not authored (D170 requires
      // the re-derivation; barrowdeepPlan.test.js recomputes each one from the
      // live rosters and this file, so copying a wrong number here fails):
      //   damage   ratio-preserved off the authored damage curve:
      //            round(14 * dmgCurve(13)/dmgCurve(6)) = round(14 * 38/17) = 31
      //   everySec ratio-preserved off the BOSS's own attack cadence, so the
      //            pulse still lands every 3.75 swings as Ashwood's does:
      //            round(9 / gorrak.attackSpeedSec * cairn_thane.attackSpeedSec)
      //            = round(9 / 2.4 * 2.2) = round(8.25) = 8
      //   radiusM  ratio-preserved as the same fraction of the boss ARENA's
      //            minimum half-extent: Ashwood's treasury is 24.5 x 31.5 m
      //            (min half 12.25) and pulses at 6 m; thaneCairn is 30 x 28 m
      //            (min half 14), so round(6 / 12.25 * 14) = round(6.857) = 7
      aoePulse: { everySec: 8, damage: 31, radiusM: 7 },
      // Structurally identical to Ashwood's — enrage is a pacing knob, not a
      // stat on any curve, so scaling it would invent a relationship that does
      // not exist.
      enrage: { afterSec: 240, mult: 1.5 },
    },
    spawns: BARROWDEEP_SPAWNS.map(({ netId, mobType, pos, count, radiusM }) => ({
      netId,
      mobType,
      pos: { x: pos.x, z: pos.z },
      count,
      radiusM,
    })),
  },
];
