/**
 * Zone 2 spatial + config integrity (M10-2).
 *
 * `validateContent()` checks that ids resolve; it has no spatial rules and it
 * never opens a worldgen config. Zone 1 gets those assertions from
 * landmarks.test.ts, which is keyed to zone 1's generated landmark table and
 * zone 1's worldgen — neither of which zone 2 has. This file is zone 2's
 * equivalent, and it is also the ONLY thing that loads zone2_world.json: the
 * Unity exporter still hardcodes zone1_world.json (M10-3), so without this
 * suite a malformed zone 2 config would sit in the repo looking plausible and
 * fail for the first time inside a Unity bake.
 *
 * The rule the file encodes: zone2_world.json is the terrain truth, and every
 * authored zone 2 coordinate is checked against it.
 */
import { describe, expect, it } from 'vitest';

import {
  ALL_NPCS,
  ALL_WAYPOINTS,
  MOBS,
  SPAWNS,
  ZONES_BY_ID,
  validateContent,
} from '../index';
import {
  ALL_LANDMARKS as ZONE2_LANDMARKS,
  landmarkPos as zone2LandmarkPos,
} from '../zones/zone2/landmarks.generated';
import type { LandmarkId as Zone2LandmarkId } from '../zones/zone2/landmarks.generated';

// eslint-disable-next-line -- JS module without types
import { createWorldgen } from '../../worldgen/index.js';
// eslint-disable-next-line -- JSON module, no types
import zone2Config from '../../config/zone2_world.json';
// eslint-disable-next-line -- JSON module, no types
import mobsManifest from '../../../../../public/assets/manifest/mobs.manifest.json';
import {
  contentPosToPx,
  resolveZone,
  zoneBoxPx,
} from '../../../../../spacetimedb/src/world/zones.ts';

const ZONE_2 = ZONES_BY_ID[2];
const ZONE_1 = ZONES_BY_ID[1];

const npcs = ALL_NPCS.filter((n) => n.zoneId === 2);
const spawns = SPAWNS.filter((s) => s.zoneId === 2);
const waypoints = ALL_WAYPOINTS.filter((w) => w.zoneId === 2);

const wg = createWorldgen(zone2Config);

const anchors = zone2Config.anchors as Record<string, { x: number; z: number; name: string }>;

/** Distance from (x,z) to segment a→b. */
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

/** Distance from (x,z) to the nearest trail centreline. */
function roadDist(x: number, z: number): number {
  let best = Infinity;
  for (const curve of wg.trailCurves as number[][][]) {
    for (let i = 0; i < curve.length - 1; i++) {
      best = Math.min(best, segDist(x, z, curve[i][0], curve[i][1], curve[i + 1][0], curve[i + 1][1]));
    }
  }
  return best;
}

describe('zone 2 exists and is wired to zone 1', () => {
  it('is in the manifest with the offset the plane was designed around', () => {
    expect(ZONE_2, 'zone 2 must exist in the manifest').toBeDefined();
    expect(ZONE_2.key).toBe('zone2');
    expect(ZONE_2.worldConfig).toBe('zone2_world.json');
    // D155: an offset region on the shared px plane, at the k·3000 m offset
    // manifest.ts and zoneBounds.test.js both already commit to.
    expect(ZONE_2.originOffsetM).toEqual({ x: 3000, z: 0 });
    expect(contentPosToPx(2, { x: 0, z: 0 })).toEqual({ x: 97600, y: 1600 });
  });

  it('continues zone 1\'s level band without leaving a gap', () => {
    expect(ZONE_2.levelBand[0]).toBe(ZONE_1.levelBand[1]);
    expect(ZONE_2.levelBand[1]).toBeGreaterThan(ZONE_2.levelBand[0]);
  });

  it('the pass is a real round trip, not a one-way stub', () => {
    // The whole point of the back-link: travelToZone (M10-11) runs in both
    // directions, so a gate whose partner points elsewhere strands the player.
    const north = ZONE_1.gates.find((g) => g.id === 'z1_north_pass');
    const south = ZONE_2.gates.find((g) => g.id === 'z2_south_pass');
    expect(north, 'zone 1 must keep z1_north_pass').toBeDefined();
    expect(south, 'zone 2 must define z2_south_pass').toBeDefined();
    expect([north!.toZoneId, north!.toGateId]).toEqual([2, 'z2_south_pass']);
    expect([south!.toZoneId, south!.toGateId]).toEqual([1, 'z1_north_pass']);
    // …and the validator agrees, on the live manifest, with nothing tolerated.
    expect(validateContent()).toEqual([]);
  });
});

describe('zone 2 bounds (the M10-1 contract)', () => {
  const box = zoneBoxPx(ZONE_2);

  it('every authored zone 2 position is inside the box the server clamps to', () => {
    // If this fails, the seeded rows land outside the accept region and the
    // players who walk to them get dragged back to the edge (R8).
    const positions = [
      ...npcs.map((n) => [`npc ${n.id}`, n.pos] as const),
      ...spawns.map((s) => [`spawn ${s.netId}`, s.pos] as const),
      ...waypoints.map((w) => [`waypoint ${w.id}`, w.pos] as const),
      ...ZONE_2.gates.map((g) => [`gate ${g.id}`, g.pos] as const),
      ['spawnPos', ZONE_2.spawnPos] as const,
      ['graveyardPos', ZONE_2.graveyardPos] as const,
    ];
    for (const [label, pos] of positions) {
      const px = contentPosToPx(2, pos);
      const r = resolveZone(px.x, px.y);
      expect(r.zoneId, `${label} resolves to zone ${r.zoneId}`).toBe(2);
      expect(r.inBounds, `${label} at px (${px.x},${px.y}) is outside zone 2's box`).toBe(true);
    }
  });

  it('the box contains the whole playable disc and still clears zone 1', () => {
    const reachM = (box.maxX - box.centerX) / 32;
    expect(reachM, 'bounds must not cut into the playable disc').toBeGreaterThan(zone2Config.radius);
    // Disjoint boxes are what makes resolveZone order-independent; the
    // validator enforces it too, this states the actual separation.
    expect(box.minX).toBeGreaterThan(zoneBoxPx(ZONE_1).maxX);
  });
});

describe('zone 2 content agrees with zone2_world.json', () => {
  it('the config builds a real world', () => {
    expect(wg.sites.trees.length).toBeGreaterThan(0);
    expect(wg.sites.rocks.length).toBeGreaterThan(0);
    // D168/D176: scatter.chestCount is now 12 (area-scaled against zone1's
    // 25). They are not server-openable yet — scripts/emit_world_chests.mjs
    // is still zone1-only (M11-2's job) — but the worldgen itself must
    // realize exactly the configured count.
    expect(wg.sites.chests.length).toBe(zone2Config.scatter.chestCount);
    expect(wg.sites.chests.length).toBe(12);
    for (const list of Object.values(wg.sites) as { x: number; z: number }[][]) {
      for (const s of list) {
        expect(Number.isFinite(s.x) && Number.isFinite(s.z)).toBe(true);
        expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(zone2Config.radius);
      }
    }
  });

  it('the hold, its graveyard and the pass sit on their config anchors and generated landmarks', () => {
    // Zone 1 gets this from landmarks.generated.ts; M11-3 (D177) gave Zone 2
    // the same emitter, so these three authored positions now have both a
    // config-anchor copy (checked here, as before) and a generated LANDMARKS
    // entry (checked below) — proving the table hasn't drifted from the
    // anchors it derives from, the same guarantee landmarks.test.ts's "stay
    // in sync with the terrain truth" test pins for Zone 1's own entries.
    // (The `graveyard` anchor key was renamed `kestrel_rest` in this same PR
    // to resolve a cross-zone landmark id collision with Zone 1's own
    // `graveyard` — see content/index.ts's ALL_LANDMARKS dupCheck.)
    expect(ZONE_2.spawnPos).toEqual({ x: anchors.kestrel_hold.x, z: anchors.kestrel_hold.z });
    expect(ZONE_2.graveyardPos).toEqual({ x: anchors.kestrel_rest.x, z: anchors.kestrel_rest.z });
    expect(ZONE_2.gates[0].pos).toEqual({ x: anchors.south_pass.x, z: anchors.south_pass.z });

    expect(zone2LandmarkPos('kestrel_hold')).toEqual(ZONE_2.spawnPos);
    expect(zone2LandmarkPos('kestrel_rest')).toEqual(ZONE_2.graveyardPos);
    expect(zone2LandmarkPos('south_pass')).toEqual(ZONE_2.gates[0].pos);
  });

  it('every POI sits exactly on the landmark it names (mirrors landmarks.test.ts for Zone 1)', () => {
    // A byPos name-lookup (the pre-M11-3 approach, back when `anchors` was
    // the only landmark-shaped set available) breaks the moment a POI sits on
    // a DERIVED landmark offset from its own anchor: poi_barrowdeep sits on
    // `barrowdeep_gate` but is labeled with `barrowdeep`'s name — the same
    // shape as Zone 1's own poi_castle_ashwood (sits on `castle_gate`,
    // labeled with `castle_ashwood`). So this uses Zone 1's real pattern
    // instead (landmarks.test.ts's "waypoints resolve to landmarks"): an
    // explicit POI-id -> landmark-id map, position-checked against the
    // generated table rather than name-matched against raw anchors.
    const expected: Record<string, Zone2LandmarkId> = {
      poi_kestrel_hold: 'kestrel_hold',
      poi_hollowmoor: 'hollowmoor',
      poi_cairnfield: 'cairnfield',
      poi_windward_scarp: 'windward_scarp',
      poi_barrowdeep: 'barrowdeep_gate',
    };
    expect(waypoints.map((w) => w.id).sort(), 'no POI left hand-placed').toEqual(
      Object.keys(expected).sort(),
    );
    for (const w of waypoints) {
      const id = expected[w.id];
      expect(id, `waypoint ${w.id} has no landmark mapping`).toBeTruthy();
      expect(w.pos, `waypoint ${w.id}`).toEqual(zone2LandmarkPos(id));
    }
  });

  // R17 (M11-4): the former version of this test required every camp to sit
  // EXACTLY on a POI's own coordinates — a bijection that read fine at 3
  // camps / 4 POIs but cannot hold at 7 camps / 4 POIs. Resolution: relax to
  // Zone 1's OWN actual invariant, not Zone 2's former stricter one.
  // landmarks.test.ts's real rule for Zone 1 is "every camp sits within 40m
  // of SOME landmark" (many camps per landmark, several landmarks with none)
  // — never a 1:1 camp<->POI pairing; Zone 1 runs 14 camps over 9 POIs today.
  // M11-3 (D177) generated Zone 2's own landmark table, so this now checks
  // against that table (`ZONE2_LANDMARKS`) directly instead of the `anchors`
  // stand-in the M11-4 version used. The table is a strict superset of the
  // anchors (it adds Blackmere, the Wildwood, the Windward Scarp summit and
  // the Barrowdeep gate on top of every authored anchor), so south_pass /
  // kestrel_rest / barrowdeep keep playing their same role — landmarks with
  // no POI of their own, the same shape as Zone 1's castle_gate / hollow_crypt
  // / frostspire_summit.
  it('every camp sits within reach of a named landmark (R17, matching Zone 1\'s own rule exactly)', () => {
    const REACH_M = 40; // the same constant landmarks.test.ts pins for Zone 1
    for (const s of spawns) {
      const nearest = Math.min(...ZONE2_LANDMARKS.map((l) => Math.hypot(s.pos.x - l.x, s.pos.z - l.z)));
      expect(nearest, `spawn ${s.netId} is ${nearest.toFixed(1)}m from the nearest landmark`)
        .toBeLessThanOrEqual(REACH_M);
    }
  });

  it('no camp is underwater', () => {
    for (const s of spawns) {
      expect(wg.lakeWaterDepthAt(s.pos.x, s.pos.z), `spawn ${s.netId} is in Blackmere`)
        .toBeLessThanOrEqual(0.05);
    }
  });
});

describe('zone 2 roster', () => {
  // Was "stays thin" (an upper-bound guard against someone filling zone 2 out
  // ahead of M11). M11-4 IS that fill (D168 items 1-3): the guard is now an
  // exact pin on the area-scaled parity targets themselves, so a future
  // over- or under-fill fails here just as loudly as the old guard did.
  it('reaches D168\'s content-parity targets exactly (+1 NPC, 6 mob types, 7 camps)', () => {
    expect(npcs.length, 'NPCs (target ceil(7 * (360/520)^2) = 4)').toBe(4);
    const mobTypesInUse = new Set(spawns.map((s) => s.mobType));
    expect(mobTypesInUse.size, 'distinct overworld mob types (target 6)').toBe(6);
    expect(spawns.length, 'camps (target ceil(14 * (360/520)^2) = 7)').toBe(7);
  });

  it('camps split 5 regular / 2 named elites at count:1, matching Zone 1\'s ~29% elite mix', () => {
    const elites = spawns.filter((s) => s.count === 1);
    const regular = spawns.filter((s) => s.count > 1);
    expect(elites.length, 'elite camps').toBe(2);
    expect(regular.length, 'regular camps').toBe(5);
    // Elites are genuinely named/rare — every regular camp actually carries
    // more than one mob.
    for (const s of regular) expect(s.count, `${s.netId}.count`).toBeGreaterThan(1);
  });

  it('the overworld level band reads 7,8,10,11,12,14 with L13 reserved for the (separate) Barrowdeep boss', () => {
    // D170: the dungeon boss is L13, `band.max - 1`, authored in the
    // Barrowdeep's own dungeon def (M11-5) — not this file. Combined with the
    // overworld set below, the band reads 7,8,10,11,12,13,14 with no hole,
    // which is D168/D170's whole point; this file owns only the overworld half.
    const levels = [...new Set(spawns.map((s) => MOBS[s.mobType].level))].sort((a, b) => a - b);
    expect(levels).toEqual([7, 8, 10, 11, 12, 14]);
  });

  it('every regular Zone 2 mob fits Zone 2\'s OWN exact curve (maxHp = 26*level + 4) — never asserted against Zone 1', () => {
    // D168's own correction: this is Zone 2's convention, not a project-wide
    // invariant (4 of Zone 1's 15 shipped mobs miss it exactly). Scoped here
    // to Zone 2's regular (non-elite) mobs only.
    const regularMobTypes = new Set(spawns.filter((s) => s.count > 1).map((s) => s.mobType));
    expect(regularMobTypes.size, 'regular mob types').toBe(4);
    for (const mobType of regularMobTypes) {
      const mob = MOBS[mobType];
      expect(mob.maxHp, `${mobType} L${mob.level} maxHp`).toBe(26 * mob.level + 4);
    }
  });

  it('every elite Zone 2 mob breaks the HP line at the documented 1.64-1.76x, pinned exactly at 1.70x', () => {
    const eliteMobTypes = new Set(spawns.filter((s) => s.count === 1).map((s) => s.mobType));
    expect(eliteMobTypes.size, 'elite mob types').toBe(2);
    for (const mobType of eliteMobTypes) {
      const mob = MOBS[mobType];
      const curve = 26 * mob.level + 4;
      const ratio = mob.maxHp / curve;
      expect(ratio, `${mobType} elite multiplier`).toBeGreaterThanOrEqual(1.64);
      expect(ratio, `${mobType} elite multiplier`).toBeLessThanOrEqual(1.76);
      expect(mob.maxHp, `${mobType} L${mob.level} maxHp (1.70x the L${mob.level} curve of ${curve})`)
        .toBe(Math.round(1.70 * curve));
    }
  });

  it('every new mob\'s glbKey resolves in the real mobs.manifest.json (read live, not a hardcoded list)', () => {
    const validKeys = Object.keys(mobsManifest.assets);
    // Sanity on the manifest itself, so a future asset-pipeline change that
    // silently drops/renames a key fails here instead of just going quiet.
    expect(validKeys.sort()).toEqual(
      ['bull', 'glubevolved', 'goblin', 'orcenemy', 'skeleton_minion', 'spider', 'tribal', 'wolf'].sort(),
    );
    for (const s of spawns) {
      const mob = MOBS[s.mobType];
      expect(validKeys, `${mob.mobType}.glbKey '${mob.glbKey}'`).toContain(mob.glbKey);
    }
  });

  it('every zone 2 mob sits inside zone 2\'s level band', () => {
    const [lo, hi] = ZONE_2.levelBand;
    for (const s of spawns) {
      const mob = MOBS[s.mobType];
      expect(mob, `spawn ${s.netId}: unknown mobType ${s.mobType}`).toBeTruthy();
      expect(mob.level, `${mob.mobType} L${mob.level} outside band [${lo},${hi}]`)
        .toBeGreaterThanOrEqual(lo);
      expect(mob.level).toBeLessThanOrEqual(hi);
    }
  });

  it('every camp\'s mob level matches its biome danger', () => {
    // Same rule landmarks.test.ts pins for zone 1, expressed against zone 2's
    // own band: expected = band[0] + danger * span. Fix a failure by moving the
    // camp or retuning that biome's danger — not by widening the tolerance.
    //
    // M11-4 did exactly the latter, once: Windward Scarp's danger was 0.7,
    // capping expected at band[0] + 0.7*span = 11.9 — below what an L14 camp
    // (frostbound_warlord, the top of the band) needs to clear TOLERANCE. Zone
    // 1's own top-band biome (Mourner's Rest) sits at danger 1.0, i.e. exactly
    // calibrated so its expected level lands at Zone 1's own band top; Zone 2's
    // Windward Scarp previously undershot that convention. Raised to 0.9
    // (expected 13.3) rather than exactly 1.0, so frostbound_raider (L12,
    // already camped there) keeps real margin (delta 1.3) instead of sitting
    // at the tolerance boundary.
    const TOLERANCE = 2;
    const [lo, hi] = ZONE_2.levelBand;
    for (const s of spawns) {
      const biome = wg.biomeAt(s.pos.x, s.pos.z);
      const expected = lo + biome.danger * (hi - lo);
      const delta = Math.abs(MOBS[s.mobType].level - expected);
      expect(
        delta,
        `${s.netId} (${s.mobType} L${MOBS[s.mobType].level}) sits in ${biome.name} `
        + `(danger ${biome.danger} → expected L${expected.toFixed(1)}), off by ${delta.toFixed(1)}`,
      ).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it('NPCs stand out of the carriageway and out of each other\'s way', () => {
    const HALF_W = zone2Config.trailHalfWidth;
    for (const n of npcs) {
      const d = roadDist(n.pos.x, n.pos.z);
      expect(d, `${n.id} is ${d.toFixed(1)}m from a road centreline (< ${HALF_W}m = in the road)`)
        .toBeGreaterThanOrEqual(HALF_W);
    }
    for (let i = 0; i < npcs.length; i++) {
      for (let j = i + 1; j < npcs.length; j++) {
        const d = Math.hypot(npcs[i].pos.x - npcs[j].pos.x, npcs[i].pos.z - npcs[j].pos.z);
        expect(d, `${npcs[i].id} <-> ${npcs[j].id} are ${d.toFixed(2)}m apart`)
          .toBeGreaterThanOrEqual(12);
      }
    }
  });

  it('every camp is a walk from the hold, not on top of it', () => {
    const hold = ZONE_2.spawnPos;
    for (const s of spawns) {
      const d = Math.hypot(s.pos.x - hold.x, s.pos.z - hold.z);
      expect(d, `${s.netId} is ${d.toFixed(0)}m from the hold`).toBeGreaterThan(40);
    }
  });
});
