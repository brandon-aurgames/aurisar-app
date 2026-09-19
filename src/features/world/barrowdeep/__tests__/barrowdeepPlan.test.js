/**
 * The Barrowdeep's plan, checked against the decisions that produced it
 * (D169-D172, D175) and against the live data those decisions were derived
 * from — never against numbers copied out of the decision log.
 *
 * Three groups of assertion, and the distinction matters when one fails:
 *
 *   1. RE-DERIVATIONS. D169 requires its terrain probes to be re-run after any
 *      zone2_world.json edit, and D170 explicitly requires the boss's stats to
 *      be re-derived from the live curves rather than copied from its own
 *      worked example. Those tests recompute from `createWorldgen(zone2_world)`
 *      and from the shipped Zone 1 / Zone 2 rosters. A failure means the inputs
 *      moved — fix the authored number, not the test.
 *   2. STRUCTURAL PINS. Cell counts, room/door/stair counts, the identity of
 *      the shared material spec. A failure means the plan grew or shrank; the
 *      cell count in particular is hundreds of kilobytes inside the published
 *      SpacetimeDB module.
 *   3. GEOMETRY INTEGRITY. Rooms do not overlap, every door joins two rooms
 *      that really share the edge it names, and every walkable cell in the
 *      whole barrow is reachable on foot from the entry spawn. That last one
 *      is the only thing standing between a hand-authored warren and a sealed
 *      room nobody notices until a player is standing in Unity looking at it.
 */
import { describe, expect, it } from 'vitest';

import * as P from '../barrowdeepPlan.js';
import { buildNav, STEP_DOWN } from '../barrowdeepNav.js';
import * as CASTLE from '../../castle/castlePlan.js';
import { DUNGEONS } from '../../content/dungeons/index.ts';
import { MOBS, ZONES_BY_ID } from '../../content/index.ts';
import { PLAYER_HALF_PX, zoneBoxPx } from '../../../../../spacetimedb/src/world/zones.ts';
import { createWorldgen } from '../../worldgen/index.js';
import zone2Config from '../../config/zone2_world.json';
import mobsManifest from '../../../../../public/assets/manifest/mobs.manifest.json';

const BARROWDEEP = DUNGEONS.find((d) => d.id === 'barrowdeep');
const ASHWOOD = DUNGEONS.find((d) => d.id === 'castle_ashwood');
const ZONE_2 = ZONES_BY_ID[2];
const ZONE_1 = ZONES_BY_ID[1];

const wg = createWorldgen(zone2Config);
const nav = buildNav(P.INTERIOR_ANCHOR);

/** Zone 2's own exact regular-mob curve (zone2/mobs.ts; pinned by zone2.test.ts). */
const hpCurve = (level) => 26 * level + 4;
/** The authored damage line, an approximation everywhere but applied uniformly. */
const dmgCurve = (level) => 3 * level - 1;

/** The room a dungeon's boss actually stands in, resolved from its own markers. */
function bossRoomRect(plan, def) {
  const marker = plan.spawnMarkers.find((s) => s.mobType === def.bossMobType);
  expect(marker, `${def.id}: no spawn marker for boss ${def.bossMobType}`).toBeDefined();
  const room = plan.rooms.find((r) => r.id === marker.roomId);
  expect(room, `${def.id}: boss marker names unknown room ${marker.roomId}`).toBeDefined();
  return room.rect;
}

const minHalfExtent = (rect) =>
  Math.min((rect.x1 - rect.x0) / 2, (rect.z1 - rect.z0) / 2);

describe('D169 — the site is re-probed against the live zone2_world.json, not trusted', () => {
  const { site } = P.EXTERIOR;

  it('EXTERIOR.site IS M11-4\'s reserved exclusion footprint, to the metre', () => {
    // The hard requirement: M11-4 added this exclusions entry and this anchor
    // specifically to keep worldgen scatter off the mound. If the plan and the
    // config disagree, either trees grow through the barrow or the exclusion
    // sterilises empty ground somewhere else.
    const barrow = zone2Config.exclusions.find((e) => e.x === site.x && e.z === site.z);
    expect(barrow, 'zone2_world.json exclusions must contain the barrow site').toBeDefined();
    expect({ x: barrow.x, z: barrow.z }).toEqual(site);
    expect(zone2Config.anchors.barrowdeep).toMatchObject({ x: site.x, z: site.z });
    expect(zone2Config.anchors.barrowdeep.name).toBe(P.BARROWDEEP_PLAN.name);
  });

  it('the exclusion disc actually covers the mound footprint it is reserving', () => {
    const barrow = zone2Config.exclusions.find((e) => e.x === site.x && e.z === site.z);
    // The worst case is a corner of the rectangular mound, not its edge.
    const moundCornerM = Math.hypot(P.EXTERIOR.halfW, P.EXTERIOR.halfD);
    expect(barrow.r).toBeGreaterThanOrEqual(moundCornerM);
    // ...and the standing-stone ring M11-12 assembles must fit inside it too.
    expect(P.EXTERIOR.stoneRing.radiusM).toBeLessThanOrEqual(barrow.r);
  });

  it('re-runs D169\'s own terrain probes at the site and the gate', () => {
    // These are measurements, not constants: the config is the worldgen's
    // input, so an added exclusion or plateau moves the ground under the
    // mound. D169 requires re-running them after any config edit, and
    // M11-4 has edited it since (chestCount 0 -> 12, plus the entry above).
    expect(wg.surfaceY(site.x, site.z)).toBeCloseTo(0.381, 3);
    expect(wg.slopeAt(site.x, site.z)).toBeCloseTo(0.0280, 4);
    expect(wg.biomeIdxAt(site.x, site.z)).toBe(1); // Cairnfield
    expect(wg.inMountain(site.x, site.z)).toBe(false);
    expect(wg.inForest(site.x, site.z)).toBe(false);
    expect(wg.lakeWaterDepthAt(site.x, site.z)).toBe(0);

    const gate = P.ENTRY.gateWorld;
    expect(wg.surfaceY(gate.x, gate.z)).toBeCloseTo(-1.339, 3);
    expect(wg.slopeAt(gate.x, gate.z)).toBeCloseTo(0.0545, 4);
    expect(wg.inMountain(gate.x, gate.z)).toBe(false);
    expect(wg.lakeWaterDepthAt(gate.x, gate.z)).toBe(0);
  });

  it('the whole mound footprint is clear ground and close to flat', () => {
    let worst = -Infinity, best = Infinity;
    for (let dx = -P.EXTERIOR.halfW; dx <= P.EXTERIOR.halfW; dx += 1) {
      for (let dz = -P.EXTERIOR.halfD; dz <= P.EXTERIOR.halfD; dz += 1) {
        const x = site.x + dx, z = site.z + dz;
        expect(wg.inMountain(x, z), `mountain at (${x}, ${z})`).toBe(false);
        expect(wg.inForest(x, z), `forest at (${x}, ${z})`).toBe(false);
        expect(wg.lakeWaterDepthAt(x, z), `water at (${x}, ${z})`).toBe(0);
        const h = wg.surfaceY(x, z);
        worst = Math.max(worst, h); best = Math.min(best, h);
      }
    }
    // D169 measured a ~2 m band across the footprint. A barrow mound is
    // authored geometry sitting ON the terrain, so this is a "does the
    // doorway end up underground" bound, not a flatness ideal.
    expect(worst - best).toBeLessThan(2.5);
  });

  it('the gate is Castle Ashwood\'s own derivation applied to this mound', () => {
    // Ashwood: 150 - 34 - 3.5 = 112.5. Barrowdeep: 125 - 20 - 3.5 = 101.5.
    const ashwoodOffset =
      CASTLE.EXTERIOR.site.x - CASTLE.ENTRY.gateWorld.x - CASTLE.EXTERIOR.halfW;
    expect(P.EXTERIOR.site.x - P.ENTRY.gateWorld.x - P.EXTERIOR.halfW).toBe(ashwoodOffset);
    expect(P.ENTRY.gateWorld).toEqual({ x: 101.5, z: -30 });
    expect(BARROWDEEP.entrance).toEqual({ zoneId: 2, pos: { x: 101.5, z: -30 } });
  });

  it('sits the documented distance from the wight camp and clear of the mountain skirt', () => {
    const camp = { x: 60, z: 10 }; // z2_wights, zone2/mobs.ts
    expect(Math.hypot(site.x - camp.x, site.z - camp.z)).toBeCloseTo(76.3, 1);
    const mtn = zone2Config.zones.mountain;
    expect(Math.hypot(site.x - mtn.x, site.z - mtn.z)).toBeGreaterThan(mtn.margin);
  });
});

describe('D170 — the boss\'s stats are RE-DERIVED here, never copied from the decision', () => {
  const gorrak = MOBS[ASHWOOD.bossMobType];
  const thane = MOBS[BARROWDEEP.bossMobType];

  it('the band relationship is Ashwood\'s, applied to Zone 2\'s band', () => {
    // Ashwood: minLevel === band.max - 2, boss === band.max - 1, both INSIDE
    // zone 1's own band. The same rule, not a second convention.
    expect(ASHWOOD.minLevel).toBe(ZONE_1.levelBand[1] - 2);
    expect(gorrak.level).toBe(ZONE_1.levelBand[1] - 1);
    expect(BARROWDEEP.minLevel).toBe(ZONE_2.levelBand[1] - 2);
    expect(thane.level).toBe(ZONE_2.levelBand[1] - 1);
    expect([BARROWDEEP.minLevel, thane.level]).toEqual([12, 13]);
  });

  it('maxHp preserves gorrak\'s ratio over the regular-mob curve at its own level', () => {
    const ratio = gorrak.maxHp / hpCurve(gorrak.level);
    expect(ratio).toBeCloseTo(2.125, 10); // 340 / 160, exact
    expect(thane.maxHp).toBe(Math.round(ratio * hpCurve(thane.level)));
    // Stated once so a silent change to either curve is visible in the diff.
    expect([hpCurve(thane.level), thane.maxHp]).toEqual([342, 727]);
  });

  it('damage preserves gorrak\'s ratio over the damage curve, and his exact spread', () => {
    const ratio = gorrak.dmgMin / dmgCurve(gorrak.level);
    expect(thane.dmgMin).toBe(Math.round(ratio * dmgCurve(thane.level)));
    expect(thane.dmgMax - thane.dmgMin).toBe(gorrak.dmgMax - gorrak.dmgMin);
    expect([thane.dmgMin, thane.dmgMax]).toEqual([45, 49]);
  });

  it('copper scales on the same damage-curve ratio, to the nearest 10', () => {
    const ratio = dmgCurve(thane.level) / dmgCurve(gorrak.level);
    expect(thane.copperMin).toBe(Math.round(gorrak.copperMin * ratio / 10) * 10);
    expect(thane.copperMin).toBe(thane.copperMax);
    expect(thane.copperMin).toBe(560);
  });

  it('aoePulse.damage scales on the authored damage-curve ratio', () => {
    const ratio = dmgCurve(thane.level) / dmgCurve(gorrak.level);
    expect(ratio).toBeCloseTo(38 / 17, 10);
    expect(BARROWDEEP.bossMechanics.aoePulse.damage)
      .toBe(Math.round(ASHWOOD.bossMechanics.aoePulse.damage * ratio));
  });

  it('aoePulse.everySec preserves the pulse-per-swing cadence, not the raw seconds', () => {
    // Ashwood pulses every 9 s against a 2.4 s swing: one pulse per 3.75
    // swings. Holding THAT constant is what "the same fight, one band up"
    // means; holding 9 s constant against a faster boss would not.
    const swingsPerPulse = ASHWOOD.bossMechanics.aoePulse.everySec / gorrak.attackSpeedSec;
    expect(swingsPerPulse).toBeCloseTo(3.75, 10);
    expect(BARROWDEEP.bossMechanics.aoePulse.everySec)
      .toBe(Math.round(swingsPerPulse * thane.attackSpeedSec));
  });

  it('aoePulse.radiusM covers the same fraction of its own boss arena', () => {
    const ashwoodArena = minHalfExtent(bossRoomRect(CASTLE.CASTLE_PLAN, ASHWOOD));
    const barrowArena = minHalfExtent(bossRoomRect(P.BARROWDEEP_PLAN, BARROWDEEP));
    const fraction = ASHWOOD.bossMechanics.aoePulse.radiusM / ashwoodArena;
    expect(BARROWDEEP.bossMechanics.aoePulse.radiusM)
      .toBe(Math.round(fraction * barrowArena));
    // Both arenas restated, since the fraction alone hides which room moved.
    expect([ashwoodArena, barrowArena]).toEqual([12.25, 14]);
    expect(BARROWDEEP.bossMechanics.aoePulse).toEqual({ everySec: 8, damage: 31, radiusM: 7 });
  });

  it('enrage keeps Castle Ashwood\'s shape exactly — it is not on any curve', () => {
    expect(BARROWDEEP.bossMechanics.enrage).toEqual(ASHWOOD.bossMechanics.enrage);
  });

  it('the boss is dungeon-only: no overworld camp spawns it', () => {
    // Gorrak's own arrangement (zone1/mobs.ts's comment): the MobDef lives in
    // the zone roster, the dungeon's spawnMarkers are the only thing that
    // places it. An accidental SPAWNS entry is how zone 1 once shipped two
    // Gorraks.
    for (const d of [ASHWOOD, BARROWDEEP]) {
      const bossMarkers = d.spawns.filter((s) => s.mobType === d.bossMobType);
      expect(bossMarkers.length, `${d.id}: exactly one boss marker`).toBe(1);
      expect(bossMarkers[0].count).toBe(1);
    }
  });

  it('trash reuses Zone 2\'s existing overworld roster — no new trash types', () => {
    const trash = [...new Set(
      BARROWDEEP.spawns.filter((s) => s.mobType !== BARROWDEEP.bossMobType).map((s) => s.mobType),
    )].sort();
    expect(trash).toEqual(['cairn_wight', 'frostbound_raider']);
    for (const t of trash) {
      expect(MOBS[t], `${t} must already exist`).toBeDefined();
      expect(MOBS[t].level).toBeLessThanOrEqual(ZONE_2.levelBand[1]);
      expect(MOBS[t].level).toBeGreaterThanOrEqual(ZONE_2.levelBand[0]);
    }
  });
});

describe('D171 — plan shape and size, pinned because they are module bytes', () => {
  it('is 2 levels / 14 rooms / 15 doors / 1 stair, exactly', () => {
    expect(P.LEVELS.length).toBe(2);
    expect(P.ROOMS.length).toBe(14);
    expect(P.DOORS.length).toBe(15);
    expect(P.STAIRS.length).toBe(1);
    expect(P.VOIDS.length).toBe(0);
    expect(P.roomsOnLevel(0).length).toBe(7);
    expect(P.roomsOnLevel(1).length).toBe(7);
  });

  it('ships D171\'s room programme verbatim', () => {
    expect(P.roomsOnLevel(1).map((r) => r.id)).toEqual([
      'entryPassage', 'foreHall', 'nicheWest', 'nicheEast', 'collapsedGallery',
      'stairPit', 'vestibule',
    ]);
    expect(P.roomsOnLevel(0).map((r) => r.id).sort()).toEqual([
      'burialNorth', 'burialSouth', 'deepCorridor', 'deepVestibule',
      'hoardChamber', 'thaneCairn', 'wardenCell',
    ]);
  });

  it('level Y values are Castle Ashwood\'s VERBATIM, not merely similar', () => {
    expect(P.LEVELS[0].y).toBe(CASTLE.LEVELS[0].y); // 0.6
    expect(P.LEVELS[1].y).toBe(CASTLE.LEVELS[1].y); // 11.0
    // ...which is the whole point: no new server or Unity constants.
    expect(P.STEP_UP).toBe(CASTLE.STEP_UP);
    expect(P.NAV_CELL).toBe(CASTLE.NAV_CELL);
    expect(P.PLAYER_R).toBe(CASTLE.PLAYER_R);
    expect(P.WALL_T).toBe(CASTLE.WALL_T);
    expect(P.SLAB_T).toBe(CASTLE.SLAB_T);
    expect(P.PLAYER_SKIN).toBe(CASTLE.PLAYER_SKIN);
  });

  it('walls meet the slab above them exactly, with no gap and no overdraw', () => {
    expect(P.LEVELS[0].y + P.LEVELS[0].clear).toBe(P.LEVELS[1].y - P.SLAB_T);
  });

  it('LOCAL_BOUNDS give exactly 180,224 nav cells — 22.3 % of Ashwood\'s', () => {
    expect(P.LOCAL_BOUNDS).toEqual({ x0: -44, z0: -32, x1: 44, z1: 32 });
    expect([nav.cols, nav.rows]).toEqual([352, 256]);
    const cells = nav.cols * nav.rows * P.LEVELS.length;
    expect(cells).toBe(180224);

    const castleCols = Math.ceil((CASTLE.LOCAL_BOUNDS.x1 - CASTLE.LOCAL_BOUNDS.x0) / CASTLE.NAV_CELL);
    const castleRows = Math.ceil((CASTLE.LOCAL_BOUNDS.z1 - CASTLE.LOCAL_BOUNDS.z0) / CASTLE.NAV_CELL);
    const castleCells = castleCols * castleRows * CASTLE.LEVELS.length;
    expect(castleCells).toBe(808500);
    expect(cells / castleCells).toBeCloseTo(0.223, 3);
  });

  it('every room sits inside LOCAL_BOUNDS with room for its own walls', () => {
    const b = P.LOCAL_BOUNDS, half = P.WALL_T / 2;
    for (const r of P.ROOMS) {
      expect(r.rect.x0 - half, `${r.id}.x0`).toBeGreaterThanOrEqual(b.x0);
      expect(r.rect.x1 + half, `${r.id}.x1`).toBeLessThanOrEqual(b.x1);
      expect(r.rect.z0 - half, `${r.id}.z0`).toBeGreaterThanOrEqual(b.z0);
      expect(r.rect.z1 + half, `${r.id}.z1`).toBeLessThanOrEqual(b.z1);
    }
  });

  it('the one stair reproduces Ashwood\'s dungeon-stair gradient rather than inventing one', () => {
    const ours = P.STAIRS[0];
    const theirs = CASTLE.STAIRS.find((s) => s.lo === 0 && s.hi === 1);
    expect(theirs, 'Ashwood must still have a dungeon->ground stair').toBeDefined();
    expect(ours.runLen).toBe(theirs.runLen);
    expect(ours.landingD).toBe(theirs.landingD);
    expect(ours.laneW).toBe(theirs.laneW);
    expect(ours.gap).toBe(theirs.gap);
    // Same rise over the same run => the same ramp, to the last digit.
    expect(P.LEVELS[1].y - P.LEVELS[0].y).toBe(CASTLE.LEVELS[1].y - CASTLE.LEVELS[0].y);
  });

  it('the plan-local stair math AGREES with castlePlan\'s, rather than assuming it', () => {
    // barrowdeepPlan deliberately re-implements stairSurfaceY instead of
    // importing castlePlan's, which closes over Ashwood's LEVELS. They agree
    // today only because D171 reuses the level Y values verbatim; this proves
    // it every run instead of leaving it as a comment.
    const st = P.STAIRS[0];
    let compared = 0;
    for (let x = st.u0 - 2; x <= st.u0 + st.runLen + st.landingD + 2; x += 0.25) {
      for (let z = st.v0 - 1; z <= st.v0 + 2 * st.laneW + st.gap + 1; z += 0.25) {
        expect(P.stairSurfaceY(st, x, z), `(${x}, ${z})`)
          .toBe(CASTLE.stairSurfaceY(st, x, z));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it('STEP_DOWN can never resolve a blocked cell onto the floor below', () => {
    // castleNav's own rule, restated against this plan's much larger gap.
    expect(STEP_DOWN).toBeLessThan((P.LEVELS[1].y - P.LEVELS[0].y) / 2);
  });
});

describe('D172 — no new art surface: materials and silhouettes are Ashwood\'s', () => {
  it('floorByKind is Castle Ashwood\'s own frozen object, shared by reference', () => {
    expect(P.MATERIAL_SPEC.floorByKind).toBe(CASTLE.MATERIAL_SPEC.floorByKind);
  });

  it('every room kind is one of the four existing dark-stone dungeon kinds', () => {
    const allowed = new Set(['dungeonHall', 'cells', 'guard', 'vault']);
    for (const r of P.ROOMS) {
      expect(allowed.has(r.kind), `${r.id} kind '${r.kind}'`).toBe(true);
      expect(CASTLE.MATERIAL_SPEC.floorByKind[r.kind], `${r.kind} has a material`).toBeTruthy();
    }
  });

  it('wall materials come from Ashwood\'s palette and windows/gilding are empty', () => {
    const palette = new Set(CASTLE.MATERIAL_SPEC.wallByLevel);
    expect(P.MATERIAL_SPEC.wallByLevel.length).toBe(P.LEVELS.length);
    for (const m of P.MATERIAL_SPEC.wallByLevel) expect(palette.has(m)).toBe(true);
    expect(P.MATERIAL_SPEC.windowedKinds).toEqual([]);
    expect(P.MATERIAL_SPEC.fancyKinds).toEqual([]);
  });

  it('every mob the barrow spawns resolves to one of the 8 existing silhouettes', () => {
    const keys = Object.keys(mobsManifest.assets);
    expect(keys.sort()).toEqual(
      ['bull', 'glubevolved', 'goblin', 'orcenemy', 'skeleton_minion', 'spider', 'tribal', 'wolf'].sort(),
    );
    for (const s of BARROWDEEP.spawns) {
      const mob = MOBS[s.mobType];
      expect(mob, `unknown mobType ${s.mobType}`).toBeDefined();
      expect(keys, `${s.mobType}.glbKey '${mob.glbKey}'`).toContain(mob.glbKey);
    }
    expect(MOBS[BARROWDEEP.bossMobType].glbKey).toBe('skeleton_minion');
  });
});

describe('D175 — the interior fits inside Zone 2\'s raised box, with the stated margin', () => {
  it('zone 2 claims 500 m, and the raise is what makes the interior legal', () => {
    expect(ZONE_2.boundsHalfExtentM).toBe(500);
    // The old 400 m box would NOT have contained the interior: stating the
    // counterfactual keeps the reason for the raise in the test, not just in
    // the decision log.
    const farEdge = P.INTERIOR_ANCHOR.x + P.LOCAL_BOUNDS.x1;
    expect(farEdge).toBe(474);
    expect(farEdge).toBeGreaterThan(400);
  });

  it('the interior footprint sits inside zone 2\'s effective reach with ~25 m to spare', () => {
    const box = zoneBoxPx(ZONE_2);
    const reachM = (box.maxX - box.centerX) / 32;
    expect(reachM).toBe(500 - PLAYER_HALF_PX / 32); // 499
    const farEdge = P.INTERIOR_ANCHOR.x + P.LOCAL_BOUNDS.x1;
    expect(reachM - farEdge).toBe(25);
    // ...and on the z axis too, where the interior is centred on the origin.
    expect(reachM - P.LOCAL_BOUNDS.z1).toBeGreaterThan(400);
  });

  it('the box stays inside zone 2\'s baked terrain, which 1000 m would not have', () => {
    // ZoneGrid's zone 2 descriptor: 4 tiles x 256 m from origin -512.
    expect(ZONE_2.boundsHalfExtentM).toBeLessThan(512);
  });

  it('the two zone boxes are still disjoint at the new extent', () => {
    const z1 = zoneBoxPx(ZONE_1), z2 = zoneBoxPx(ZONE_2);
    expect([z1.minX, z1.maxX]).toEqual([-30368, 33568]);
    expect([z2.minX, z2.maxX]).toEqual([81632, 113568]);
    expect(z2.minX).toBeGreaterThan(z1.maxX);
  });

  it('the anchor is due east, mirroring Ashwood\'s own convention', () => {
    expect(P.INTERIOR_ANCHOR).toEqual({ x: 430, z: 0 });
    expect(P.INTERIOR_ANCHOR.z).toBe(CASTLE.INTERIOR_ANCHOR.z);
    expect(P.ZONE_ID).toBe(2);
    expect(BARROWDEEP.entrance.zoneId).toBe(P.ZONE_ID);
  });
});

describe('geometry integrity — the part a hand-authored warren gets wrong', () => {
  it('no two rooms on the same level overlap', () => {
    for (let i = 0; i < P.ROOMS.length; i++) {
      for (let j = i + 1; j < P.ROOMS.length; j++) {
        const a = P.ROOMS[i], b = P.ROOMS[j];
        if (a.level !== b.level) continue;
        const overlap =
          a.rect.x0 < b.rect.x1 && b.rect.x0 < a.rect.x1 &&
          a.rect.z0 < b.rect.z1 && b.rect.z0 < a.rect.z1;
        expect(overlap, `${a.id} overlaps ${b.id} on level ${a.level}`).toBe(false);
      }
    }
  });

  it('room ids and door ids are unique', () => {
    expect(new Set(P.ROOMS.map((r) => r.id)).size).toBe(P.ROOMS.length);
    expect(new Set(P.DOORS.map((d) => d.id)).size).toBe(P.DOORS.length);
  });

  it('every door joins two rooms that really share the edge it names', () => {
    for (const d of P.DOORS) {
      const a = P.ROOMS_BY_ID[d.a];
      expect(a, `${d.id}: unknown room ${d.a}`).toBeDefined();
      expect(d.lo, `${d.id}: lo < hi`).toBeLessThan(d.hi);
      // The opening must survive the player-radius inset the nav strip applies.
      expect(d.hi - d.lo, `${d.id}: opening wider than the player`).toBeGreaterThan(2 * P.PLAYER_R);

      if (d.b === 'EXTERIOR') {
        // The gate line must be one of its room's own walls.
        expect(d.edge).toBe('x');
        expect([a.rect.x0, a.rect.x1]).toContain(d.at);
        continue;
      }
      const b = P.ROOMS_BY_ID[d.b];
      expect(b, `${d.id}: unknown room ${d.b}`).toBeDefined();
      expect(a.level, `${d.id}: joins two levels`).toBe(b.level);

      if (d.edge === 'x') {
        // Shared wall runs along z at x = at.
        expect([a.rect.x0, a.rect.x1], `${d.id}: at not on ${d.a}'s wall`).toContain(d.at);
        expect([b.rect.x0, b.rect.x1], `${d.id}: at not on ${d.b}'s wall`).toContain(d.at);
        const lo = Math.max(a.rect.z0, b.rect.z0), hi = Math.min(a.rect.z1, b.rect.z1);
        expect(d.lo, `${d.id}: opening below the shared span`).toBeGreaterThanOrEqual(lo);
        expect(d.hi, `${d.id}: opening above the shared span`).toBeLessThanOrEqual(hi);
      } else {
        expect([a.rect.z0, a.rect.z1], `${d.id}: at not on ${d.a}'s wall`).toContain(d.at);
        expect([b.rect.z0, b.rect.z1], `${d.id}: at not on ${d.b}'s wall`).toContain(d.at);
        const lo = Math.max(a.rect.x0, b.rect.x0), hi = Math.min(a.rect.x1, b.rect.x1);
        expect(d.lo).toBeGreaterThanOrEqual(lo);
        expect(d.hi).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('exactly one door is the exterior lintel, and it is the west wall', () => {
    const exterior = P.DOORS.filter((d) => d.b === 'EXTERIOR');
    expect(exterior.length).toBe(1);
    expect(exterior[0].sealed).toBe(true);
    expect(P.EXTERIOR.facing).toBe('west');
    // West == -x, and the gate sits on the westmost wall in the whole plan.
    expect(exterior[0].at).toBe(Math.min(...P.ROOMS.map((r) => r.rect.x0)));
    // The lintel opening and the nav door agree on their width.
    expect(P.EXTERIOR.lintel.width).toBe(exterior[0].hi - exterior[0].lo);
    expect(P.EXTERIOR.lintel.z).toBe(P.EXTERIOR.site.z);
  });

  it('the stair sits inside a stacked pair of rooms, one per level', () => {
    const fp = P.stairRects(P.STAIRS[0]).footprint;
    const hosts = P.ROOMS.filter((r) =>
      fp.x0 >= r.rect.x0 && fp.x1 <= r.rect.x1 && fp.z0 >= r.rect.z0 && fp.z1 <= r.rect.z1);
    expect(hosts.map((r) => r.id).sort()).toEqual(['deepVestibule', 'stairPit']);
    expect(new Set(hosts.map((r) => r.level))).toEqual(new Set([0, 1]));
    // The two host rooms occupy the same XZ — Castle Ashwood's d/gVestibule
    // arrangement, which is what keeps the shaft hole over real floor.
    expect(hosts[0].rect).toEqual(hosts[1].rect);
  });
});

describe('navigation — the barrow is actually walkable, end to end', () => {
  const A = P.INTERIOR_ANCHOR;
  const cellKey = (col, row, level) => `${col},${row},${level}`;

  /** Flood fill on foot from the entry spawn across both level grids. */
  const reached = (() => {
    const spawn = P.ENTRY.spawnLocal;
    const s0 = nav.surfaceAt(spawn.x + A.x, spawn.z + A.z, P.LEVELS[1].y);
    expect(s0, 'the entry spawn must stand on real floor').not.toBeNull();
    const seen = new Set();
    const c0 = nav._local.colOf(spawn.x), r0 = nav._local.rowOf(spawn.z);
    seen.add(cellKey(c0, r0, s0.level));
    const stack = [[c0, r0, s0.y]];
    while (stack.length) {
      const [c, r, y] = stack.pop();
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nc >= nav.cols || nr < 0 || nr >= nav.rows) continue;
        const s = nav.surfaceAt(nav._local.cellX(nc) + A.x, nav._local.cellZ(nr) + A.z, y);
        if (!s) continue;
        const k = cellKey(nc, nr, s.level);
        if (seen.has(k)) continue;
        seen.add(k);
        stack.push([nc, nr, s.y]);
      }
    }
    return seen;
  })();

  it('leaves NO walkable cell stranded anywhere in the plan', () => {
    // The real test. A sealed room, a door whose strip misses its wall, a
    // stair landing one cell short — all of them show up here as orphans, and
    // none of them shows up anywhere else until someone walks into it.
    const orphans = [];
    for (let level = 0; level < nav.grids.length; level++) {
      for (let r = 0; r < nav.rows; r++) {
        for (let c = 0; c < nav.cols; c++) {
          const v = nav.grids[level][r * nav.cols + c];
          if (v === 0) continue;
          const probeY = v === 1 ? P.LEVELS[level].y : P.LEVELS[1].y + 1;
          const s = nav.surfaceAt(nav._local.cellX(c) + A.x, nav._local.cellZ(r) + A.z, probeY);
          if (!s) continue; // railing gap between the stair lanes — blocked by design
          if (!reached.has(cellKey(c, r, s.level))) {
            orphans.push(`L${level} (${nav._local.cellX(c)}, ${nav._local.cellZ(r)})`);
          }
        }
      }
    }
    expect(orphans.slice(0, 10)).toEqual([]);
  });

  it('every room has reachable floor, the boss chamber included', () => {
    const inset = P.PLAYER_R + P.WALL_T / 2;
    for (const room of P.ROOMS) {
      let any = false;
      for (let x = room.rect.x0 + inset; x <= room.rect.x1 - inset && !any; x += P.NAV_CELL) {
        for (let z = room.rect.z0 + inset; z <= room.rect.z1 - inset && !any; z += P.NAV_CELL) {
          const s = nav.surfaceAt(x + A.x, z + A.z, P.LEVELS[room.level].y);
          if (s && reached.has(cellKey(nav._local.colOf(x), nav._local.rowOf(z), s.level))) any = true;
        }
      }
      expect(any, `${room.id} (level ${room.level}) has no reachable floor`).toBe(true);
    }
  });

  it('the entry spawn and the exit hotspot are both on the entry level, inside the passage', () => {
    for (const [label, local] of [['spawn', P.ENTRY.spawnLocal], ['exit', P.ENTRY.exitHotspotLocal]]) {
      const s = nav.surfaceAt(local.x + A.x, local.z + A.z, P.LEVELS[1].y);
      expect(s, `${label} is not on floor`).not.toBeNull();
      expect(s.level, `${label} level`).toBe(1);
      expect(s.y).toBe(P.LEVELS[1].y);
      expect(P.inRect(P.ROOMS_BY_ID.entryPassage.rect, local.x, local.z, P.PLAYER_R)).toBe(true);
    }
    // The exit hotspot must be reachable from the spawn WITHOUT leaving the
    // room, or a player who walks in cannot walk back out.
    expect(Math.abs(P.ENTRY.spawnLocal.x - P.ENTRY.exitHotspotLocal.x)).toBe(7);
    // ...and it must be closer to the lintel than the spawn, or "walk back to
    // the door to leave" stops meaning anything.
    expect(P.ENTRY.exitHotspotLocal.x).toBeLessThan(P.ENTRY.spawnLocal.x);
  });

  it('the spawn inset offsets are Castle Ashwood\'s own, to the centimetre', () => {
    const gateLine = P.DOORS.find((d) => d.b === 'EXTERIOR').at;
    const castleGate = CASTLE.DOORS.find((d) => d.b === 'EXTERIOR').at;
    expect(P.ENTRY.spawnLocal.x - gateLine)
      .toBe(CASTLE.ENTRY.spawnLocal.x - castleGate);
    expect(P.ENTRY.exitHotspotLocal.x - gateLine)
      .toBe(CASTLE.ENTRY.exitHotspotLocal.x - castleGate);
    expect(P.ENTRY.spawnFacing).toBe(CASTLE.ENTRY.spawnFacing);
  });

  it('every spawn marker stands on reachable floor of its own room\'s level', () => {
    for (const m of P.SPAWN_MARKERS) {
      const room = P.ROOMS_BY_ID[m.roomId];
      expect(room, `${m.netId}: unknown room ${m.roomId}`).toBeDefined();
      const s = nav.surfaceAt(m.pos.x + A.x, m.pos.z + A.z, P.LEVELS[room.level].y);
      expect(s, `${m.netId} is not on floor`).not.toBeNull();
      expect(s.level, `${m.netId} level`).toBe(room.level);
      expect(reached.has(cellKey(nav._local.colOf(m.pos.x), nav._local.rowOf(m.pos.z), s.level)))
        .toBe(true);
    }
  });

  it('no spawn radius can scatter a mob through its own room\'s wall', () => {
    // spawnInstanceOffsetM (dungeon/helpers.ts) offsets each instance by up to
    // radiusM from the marker, which sits at the room centre.
    const inset = P.PLAYER_R + P.WALL_T / 2;
    for (const m of P.SPAWN_MARKERS) {
      const { rect } = P.ROOMS_BY_ID[m.roomId];
      const halfW = (rect.x1 - rect.x0) / 2 - inset;
      const halfD = (rect.z1 - rect.z0) / 2 - inset;
      expect(m.radiusM, `${m.netId} radius vs its room`).toBeLessThanOrEqual(Math.min(halfW, halfD));
    }
  });

  it('the stair is the only way between the two levels, and it works both ways', () => {
    const st = P.STAIRS[0];
    const { laneA, laneB, landing } = P.stairRects(st);
    const mid = (r) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });

    // Bottom of lane A is the deep floor; top of lane B is the gallery floor.
    expect(P.stairSurfaceY(st, st.u0, mid(laneA).z)).toBe(P.LEVELS[0].y);
    expect(P.stairSurfaceY(st, st.u0, mid(laneB).z)).toBe(P.LEVELS[1].y);
    // The landing sits exactly half way.
    expect(P.stairSurfaceY(st, mid(landing).x, mid(landing).z))
      .toBe((P.LEVELS[0].y + P.LEVELS[1].y) / 2);
    // The railing gap between the lanes is not walkable.
    expect(P.stairSurfaceY(st, mid(laneA).x, (laneA.z1 + laneB.z0) / 2)).toBeNull();

    // Walking the ramp never asks for more than one STEP_UP at a time.
    let prev = P.stairSurfaceY(st, st.u0, mid(laneA).z);
    for (let x = st.u0; x <= st.u0 + st.runLen; x += P.NAV_CELL) {
      const y = P.stairSurfaceY(st, x, mid(laneA).z);
      expect(y - prev, `rise at x=${x}`).toBeLessThanOrEqual(P.STEP_UP);
      prev = y;
    }
  });
});

describe('the emitted manifest is this plan, not a drifted copy', () => {
  it('registers the dungeon under the id and name the plan states', () => {
    expect(BARROWDEEP.id).toBe('barrowdeep');
    expect(BARROWDEEP.name).toBe('The Barrowdeep');
    expect(BARROWDEEP.name).toBe(P.BARROWDEEP_PLAN.name);
    expect(BARROWDEEP.layoutManifest).toBe('barrowdeep.json');
  });

  it('DungeonDef.spawns mirror the plan\'s markers exactly', () => {
    expect(BARROWDEEP.spawns.map((s) => s.netId))
      .toEqual(P.SPAWN_MARKERS.map((s) => s.netId));
    for (const marker of P.SPAWN_MARKERS) {
      const spawn = BARROWDEEP.spawns.find((s) => s.netId === marker.netId);
      expect(spawn.pos).toEqual({ x: marker.pos.x, z: marker.pos.z });
      expect([spawn.mobType, spawn.count, spawn.radiusM])
        .toEqual([marker.mobType, marker.count, marker.radiusM]);
    }
  });

  it('netIds cannot collide with Castle Ashwood\'s', () => {
    // dungeonSpawnByNetId and dungeonSpawnFloorByNetId are both keyed on netId
    // ALONE across every dungeon, so a collision silently reassigns a mob.
    const all = DUNGEONS.flatMap((d) => d.spawns.map((s) => s.netId));
    expect(new Set(all).size).toBe(all.length);
  });
});
