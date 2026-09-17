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

// eslint-disable-next-line -- JS module without types
import { createWorldgen } from '../../worldgen/index.js';
// eslint-disable-next-line -- JSON module, no types
import zone2Config from '../../config/zone2_world.json';
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
    // Chests are deliberately zero: the server chest manifest is emitted from
    // zone1_world.json only, so zone 2 chests would be unopenable.
    expect(wg.sites.chests).toEqual([]);
    for (const list of Object.values(wg.sites) as { x: number; z: number }[][]) {
      for (const s of list) {
        expect(Number.isFinite(s.x) && Number.isFinite(s.z)).toBe(true);
        expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(zone2Config.radius);
      }
    }
  });

  it('the hold, its graveyard and the pass sit on their config anchors', () => {
    // Zone 1 gets this from landmarks.generated.ts. Zone 2 has no emitter yet,
    // so the anchors block is the single source and these are the copies.
    expect(ZONE_2.spawnPos).toEqual({ x: anchors.kestrel_hold.x, z: anchors.kestrel_hold.z });
    expect(ZONE_2.graveyardPos).toEqual({ x: anchors.graveyard.x, z: anchors.graveyard.z });
    expect(ZONE_2.gates[0].pos).toEqual({ x: anchors.south_pass.x, z: anchors.south_pass.z });
  });

  it('every POI sits on a config anchor, and every camp on a POI', () => {
    const byPos = new Map(
      Object.values(anchors).map((a) => [`${a.x},${a.z}`, a.name]),
    );
    for (const w of waypoints) {
      const name = byPos.get(`${w.pos.x},${w.pos.z}`);
      expect(name, `waypoint ${w.id} is not on any zone2_world.json anchor`).toBeTruthy();
      expect(w.label, `waypoint ${w.id} label`).toBe(name);
    }
    // A camp the map cannot name is a camp no breadcrumb can lead a player to.
    for (const s of spawns) {
      const poi = waypoints.find((w) => w.pos.x === s.pos.x && w.pos.z === s.pos.z);
      expect(poi, `spawn ${s.netId} has no POI on it`).toBeTruthy();
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
  it('stays thin — this is the first pass, not content parity (D162)', () => {
    // Guards the scope cut in the direction it actually fails: someone filling
    // zone 2 out here instead of in M11, where the Unity side is ready for it.
    expect(npcs.length).toBeLessThanOrEqual(4);
    expect(spawns.length).toBeLessThanOrEqual(4);
    expect(npcs.length).toBeGreaterThan(0);
    expect(spawns.length).toBeGreaterThan(0);
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
