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
  dungeonSpawnFloorYM,
  dungeonSpawnPx,
  dungeonUsesCastleInteriorNav,
  interiorLocalToPx,
  zoneEntranceToPx,
} from '../../../../spacetimedb/src/dungeon/helpers.ts';
import { DUNGEONS } from '../../../../spacetimedb/src/content/index.js';
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
    expect(dungeonUsesCastleInteriorNav(unregistered.id)).toBe(false);
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

describe('castle nav bitmaps are claimed only by the dungeon they actually describe', () => {
  it('Castle Ashwood claims them; the Barrowdeep does not', () => {
    // The Barrowdeep IS registered (so the fallbacks above never fire for it),
    // but its bitmaps live in barrowdeep/navGrids.ts and castle/surface.ts's
    // scan closes over Castle Ashwood's meta/levels/stairs. Saying "true" here
    // would resolve every step taken inside the barrow against Ashwood's walls
    // ~3 km away in another zone — D174 item 3 restated for a real second
    // dungeon rather than a hypothetical one. Interior wall collision inside
    // the Barrowdeep is therefore not enforced server-side yet; that is a
    // stated gap with its own follow-up, not an accident.
    expect(dungeonUsesCastleInteriorNav('castle_ashwood')).toBe(true);
    expect(dungeonUsesCastleInteriorNav('barrowdeep')).toBe(false);
    expect(DUNGEON_INTERIOR_ENTRY.castle_ashwood.castleNavBitmaps).toBe(true);
    expect(DUNGEON_INTERIOR_ENTRY.barrowdeep.castleNavBitmaps).toBe(false);
  });

  it('a dungeon whose interior is not in zone 1 can never claim them', () => {
    // castle/surface.ts converts px with a zero origin offset throughout
    // (pxToWorldM's own default), so its bitmaps are only addressable from
    // zone 1. This is the structural version of the assertion above: it keeps
    // holding when a fourth dungeon lands in zone 3.
    for (const [id, entry] of Object.entries(DUNGEON_INTERIOR_ENTRY)) {
      if (!entry.castleNavBitmaps) continue;
      const dungeon = DUNGEONS.find((d) => d.id === id)!;
      expect(dungeon.entrance.zoneId, `${id} claims castle nav bitmaps outside zone 1`).toBe(1);
      expect(entry.anchor).toEqual(CASTLE_INTERIOR_ANCHOR);
    }
  });
});
