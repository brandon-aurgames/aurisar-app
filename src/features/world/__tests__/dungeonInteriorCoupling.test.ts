/**
 * The interior-entry table is the ONLY thing keeping interiorLocalToPx and
 * dungeonSpawnPx from disagreeing — so this file gates the table.
 *
 * M11-1's review left this as a named, unfixed follow-up: the two functions
 * have DIFFERENT fallbacks for a dungeon with no row in DUNGEON_INTERIOR_ENTRY.
 * interiorLocalToPx falls back to Castle Ashwood's anchor (840 m east) in the
 * caller's own zone; dungeonSpawnPx falls back to the dungeon's outdoor gate.
 * Both are individually defensible and both are documented, but together they
 * mean an unregistered dungeon's "interior origin" and its "spawn point" sit
 * hundreds of metres apart with nothing reporting it.
 *
 * That was harmless while Castle Ashwood was the only dungeon. The Barrowdeep
 * makes it a live trap for dungeon number three: a content author who adds a
 * DungeonDef and forgets the interior row gets a dungeon that spawns players at
 * its gate while every interior coordinate resolves against Ashwood's anchor —
 * no error, no log line, and no local symptom, which is M10's R8 trap and D165
 * before it wearing a third hat.
 *
 * The fix is not to change either fallback (each is right for its own caller);
 * it is to make "no row" unreachable for real content and to keep the
 * divergence visible on purpose. Hence two halves below.
 *
 * WHY THIS FILE IS HERE and not beside helpers.ts: `spacetime publish`
 * type-checks the WHOLE spacetimedb/src tree, test files included, and
 * spacetimedb/package.json does not declare vitest (the live module has been
 * failing to publish on exactly that since M11-1 — a fix is in flight on its
 * own branch, and that package.json is reserved). Adding another
 * vitest-importing file under spacetimedb/src would deepen that, so this test
 * sits in the root tree and reaches across, the same way zoneBounds.test.js
 * already does for spacetimedb/src/world/zones.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  CASTLE_INTERIOR_ANCHOR,
  DUNGEON_INTERIOR_ENTRY,
  dungeonExitHotspotPx,
  dungeonInteriorNavFor,
  dungeonSpawnFloorYM,
  dungeonSpawnPx,
  interiorLocalToPx,
  zoneEntranceToPx,
} from '../../../../spacetimedb/src/dungeon/helpers.ts';
import { DUNGEONS, ZONES } from '../../../../spacetimedb/src/content/index.js';
import { contentPosToPx } from '../../../../spacetimedb/src/world/zones.ts';
import { CASTLE_LEVELS } from '../../../../spacetimedb/src/castle/navGrids.ts';
import { BARROWDEEP_LEVELS } from '../../../../spacetimedb/src/barrowdeep/navGrids.ts';
import type { DungeonDef } from '../../../../spacetimedb/src/content/types.js';

/** Each dungeon's own level heights, read from its own emitted nav module. */
const DUNGEON_LEVEL_Y: Record<string, number[]> = {
  castle_ashwood: CASTLE_LEVELS.map((l) => l.y),
  barrowdeep: BARROWDEEP_LEVELS.map((l) => l.y),
};

describe('every shipped dungeon has an interior row, so the fallbacks never fire', () => {
  it('covers the full DUNGEONS list — the guard a third dungeon will trip', () => {
    const missing = DUNGEONS
      .filter((d) => !(d.id in DUNGEON_INTERIOR_ENTRY))
      .map((d) => d.id);
    expect(
      missing,
      'every DungeonDef needs a DUNGEON_INTERIOR_ENTRY row (dungeon/helpers.ts) — ' +
      'without one its interior resolves against Castle Ashwood\'s anchor while ' +
      'its spawn resolves to its outdoor gate, silently',
    ).toEqual([]);
    // Sanity that the list is not empty, so an accidental import failure
    // cannot make the assertion above vacuously true.
    expect(DUNGEONS.length).toBeGreaterThanOrEqual(2);
  });

  it('and no row exists for a dungeon that is not shipped', () => {
    const ids = new Set(DUNGEONS.map((d) => d.id));
    for (const id of Object.keys(DUNGEON_INTERIOR_ENTRY)) {
      expect(ids.has(id), `${id} has an interior row but no DungeonDef`).toBe(true);
    }
  });

  it.each(DUNGEONS.map((d) => [d.id, d] as [string, DungeonDef]))(
    '%s: spawn and exit BOTH resolve through interiorLocalToPx, agreeing with the table',
    (_id, dungeon) => {
      const entry = DUNGEON_INTERIOR_ENTRY[dungeon.id];
      // This is the coupling itself: with a row present, dungeonSpawnPx must
      // be exactly interiorLocalToPx of the row's own spawnLocal. If either
      // function's fallback were taken here, these would differ.
      expect(dungeonSpawnPx(dungeon)).toEqual(interiorLocalToPx(dungeon, entry.spawnLocal));
      expect(dungeonExitHotspotPx(dungeon))
        .toEqual(interiorLocalToPx(dungeon, entry.exitHotspotLocal));
      // And neither may collapse onto the outdoor gate, which is what the
      // no-row fallback returns — i.e. the row is actually being used.
      expect(dungeonSpawnPx(dungeon)).not.toEqual(zoneEntranceToPx(dungeon));
      expect(dungeonExitHotspotPx(dungeon)).not.toEqual(zoneEntranceToPx(dungeon));
    },
  );

  it.each(DUNGEONS.map((d) => [d.id, d] as [string, DungeonDef]))(
    '%s: its interior resolves against ITS OWN zone, not zone 1 by default',
    (_id, dungeon) => {
      const entry = DUNGEON_INTERIOR_ENTRY[dungeon.id];
      expect(interiorLocalToPx(dungeon, { x: 0, z: 0 }))
        .toEqual(contentPosToPx(dungeon.entrance.zoneId, entry.anchor));
    },
  );
});

describe('the divergence itself, kept visible rather than papered over', () => {
  // Registered nowhere, and deliberately not 'barrowdeep' — this is the shape
  // of the MISTAKE, so it must stay a dungeon the repo does not ship.
  const unregistered: DungeonDef = {
    id: 'test_only_unregistered_dungeon',
    name: 'Test-Only Unregistered Dungeon (zone 2)',
    minLevel: 1,
    entrance: { zoneId: 2, pos: { x: 101.5, z: -30 } },
    layoutManifest: 'test_only_unregistered.json',
    bossMobType: 'test_only_boss',
    bossMechanics: {},
    spawns: [],
  };

  it('has no row, by construction', () => {
    expect(unregistered.id in DUNGEON_INTERIOR_ENTRY).toBe(false);
    expect(DUNGEONS.some((d) => d.id === unregistered.id)).toBe(false);
  });

  it('interiorLocalToPx falls back to Ashwood\'s anchor while dungeonSpawnPx falls back to the gate', () => {
    const interiorOrigin = interiorLocalToPx(unregistered, { x: 0, z: 0 });
    const spawn = dungeonSpawnPx(unregistered);
    // Right zone (D173 item 2 is fixed), wrong place within it.
    expect(interiorOrigin)
      .toEqual(contentPosToPx(unregistered.entrance.zoneId, CASTLE_INTERIOR_ANCHOR));
    expect(spawn).toEqual(zoneEntranceToPx(unregistered));
    expect(interiorOrigin).not.toEqual(spawn);
    // Quantified, so the size of the trap is on the record: Ashwood's 840 m
    // anchor against this gate's 101.5 m is ~738 m apart, i.e. an interior
    // nowhere near where the player is put.
    const apartM = Math.abs(interiorOrigin.x - spawn.x) / 32;
    expect(apartM).toBeCloseTo(CASTLE_INTERIOR_ANCHOR.x - unregistered.entrance.pos.x, 6);
    expect(apartM).toBeGreaterThan(700);
  });

  it('and an unregistered dungeon is never checked against Castle Ashwood\'s walls', () => {
    expect(dungeonInteriorNavFor(unregistered.id)).toBeNull();
  });
});

describe('spawn floor heights resolve per dungeon, not through one shared table', () => {
  // seedDungeonInstanceMobs writes mob.floorYM straight from dungeonSpawnFloorYM
  // (index.ts), keyed on netId alone. That map used to be built from Castle
  // Ashwood's rooms only, so a Barrowdeep netId would have fallen through to
  // the shared default — every mob in the barrow's lower level spawned a
  // storey up, inside the rock, with nothing reporting it.
  it.each(DUNGEONS.flatMap((d) => d.spawns.map((s) => [d.id, s.netId] as [string, string])))(
    '%s / %s lands on a real floor height of its own dungeon',
    (dungeonId, netId) => {
      const y = dungeonSpawnFloorYM(netId);
      const levels = DUNGEON_LEVEL_Y[dungeonId];
      expect(levels, `no level table for ${dungeonId}`).toBeDefined();
      expect(levels, `${netId} floorYM ${y} is not one of ${dungeonId}'s level heights`)
        .toContain(y);
    },
  );

  it('the Barrowdeep really does place mobs on BOTH of its levels', () => {
    // Guards the shape of the failure above: if every bd_* netId resolved to
    // the shared default, the test above would still pass (11.0 is a real
    // Barrowdeep level height) while every deep-level mob floated.
    const ys = new Set(
      DUNGEONS.find((d) => d.id === 'barrowdeep')!.spawns.map((s) => dungeonSpawnFloorYM(s.netId)),
    );
    expect([...ys].sort((a, b) => a - b)).toEqual([0.6, 11]);
  });
});

describe('every dungeon resolves against the nav bitmaps that actually describe IT (R21)', () => {
  // This block used to pin `castleNavBitmaps: boolean` — "does this dungeon
  // resolve against castle/navGrids.ts specifically" — and the Barrowdeep had
  // to answer FALSE. That was the honest answer to the wrong question:
  // castle/surface.ts's scan closed over Ashwood's meta/levels/stairs, so
  // claiming them would have checked every step inside the barrow against
  // Ashwood's walls ~3 km away in another zone, but answering "no" meant no
  // wall collision inside it at all AND a player floorYM forced to 0 on the
  // first step while the instance's mobs sat on 11.0 / 0.6 (D174 item 3).
  //
  // R21 replaced the boolean with a real per-dungeon grid reference, so the
  // assertions below flip DELIBERATELY: the Barrowdeep now has interior nav,
  // and what is pinned is that it is its OWN, never Ashwood's.
  it('the Barrowdeep now has interior nav, and it is not Castle Ashwood\'s', () => {
    const ashwood = dungeonInteriorNavFor('castle_ashwood');
    const barrowdeep = dungeonInteriorNavFor('barrowdeep');
    expect(ashwood).not.toBeNull();
    expect(barrowdeep).not.toBeNull();
    expect(barrowdeep).not.toBe(ashwood);
    expect(ashwood!.meta.anchor).toEqual(CASTLE_INTERIOR_ANCHOR);
    // Zone 2's own anchor (D175), three kilometres and a zone away.
    expect(barrowdeep!.zoneId).toBe(2);
    expect(barrowdeep!.meta.anchor).not.toEqual(CASTLE_INTERIOR_ANCHOR);
    expect(DUNGEON_INTERIOR_ENTRY.castle_ashwood.nav).toBe(ashwood);
    expect(DUNGEON_INTERIOR_ENTRY.barrowdeep.nav).toBe(barrowdeep);
  });

  it.each(DUNGEONS.map((d) => [d.id, d] as [string, DungeonDef]))(
    '%s: its nav row names itself, its own zone, and its own placement anchor',
    (_id, dungeon) => {
      const entry = DUNGEON_INTERIOR_ENTRY[dungeon.id];
      const nav = dungeonInteriorNavFor(dungeon.id);
      expect(nav, `${dungeon.id} has no interior nav`).not.toBeNull();
      // A row can only ever point at its own grids — the structural version of
      // the retired boolean, and the thing that keeps holding for dungeon
      // number three in zone 3.
      expect(nav!.dungeonId).toBe(dungeon.id);
      expect(nav!.zoneId, `${dungeon.id}'s interior resolves in the wrong zone`)
        .toBe(dungeon.entrance.zoneId);
      // Placement (interiorLocalToPx, which spawns the mobs) and wall
      // collision (the nav scan) must share ONE origin, or mobs land where the
      // grid says there is nothing.
      expect(nav!.meta.anchor).toEqual(entry.anchor);
      const zone = ZONES.find((z) => z.id === dungeon.entrance.zoneId)!;
      expect(nav!.originOffsetM).toEqual(zone.originOffsetM);
    },
  );

  it('no two interiors overlap in world metres, so no step can resolve in the wrong one', () => {
    // The failure this rules out is the one the retired boolean was guarding
    // against, restated as geometry instead of as a flag: if two dungeons'
    // footprints ever intersected, a position inside both would resolve
    // against whichever descriptor the caller happened to be holding.
    const boxes = DUNGEONS.map((d) => {
      const nav = dungeonInteriorNavFor(d.id)!;
      const { anchor, bounds } = nav.meta;
      return {
        id: d.id,
        x0: anchor.x + bounds.x0 + nav.originOffsetM.x,
        x1: anchor.x + bounds.x1 + nav.originOffsetM.x,
        z0: anchor.z + bounds.z0 + nav.originOffsetM.z,
        z1: anchor.z + bounds.z1 + nav.originOffsetM.z,
      };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const overlaps = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
        expect(overlaps, `${a.id} and ${b.id} interiors overlap`).toBe(false);
      }
    }
  });
});
