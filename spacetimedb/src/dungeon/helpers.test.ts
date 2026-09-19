/**
 * D173 item 2 / D174 items 1-3, proved against a second, non-Zone-1 dungeon.
 *
 * `interiorLocalToPx` used to fold CASTLE_INTERIOR_ANCHOR against
 * WORLD_CENTER_PX unconditionally — i.e. implicitly zone 1's origin — for
 * EVERY dungeon's interior (D173 item 2: zoneEntranceToPx's own doc comment
 * already told this story for the entrance side; this was the interior side
 * of the same bug, and it survived D156). Separately, index.ts hardcoded
 * `dungeonId === 'castle_ashwood'` to decide spawn/exit/nav behaviour
 * (D174), so a second dungeon would have spawned at its own gate instead of
 * inside, ejected leavers at Ashwood's gate in zone 1, and had its movement
 * checked against Ashwood's nav grids regardless of which dungeon it was.
 *
 * Castle Ashwood is the only real DungeonDef that exists today (this PR adds
 * no second dungeon — that is separate, parallel content work). This file
 * proves two things against it:
 *
 *   1. Every Ashwood-facing function is BYTE-IDENTICAL to its pre-fix
 *      output — proved against oracle functions that are verbatim
 *      transcriptions of the retired code, not hand-computed numbers, so a
 *      mistake here cannot hide as a passing test the way a wrong hardcoded
 *      literal could.
 *   2. A synthetic, test-only second DungeonDef — entirely local to this
 *      file, registered nowhere, using content id 'test_only_synthetic_2'
 *      so it can never collide with the real Barrowdeep id a parallel task
 *      is authoring — resolves its interior/spawn/exit against its OWN
 *      zone's real origin offset (zone 2, already-shipped content from
 *      content/zones/manifest.ts) instead of zone 1's. Zone 2 is real,
 *      shipped content; only the DUNGEON hosted "in" it here is fake.
 */
import { describe, expect, it } from 'vitest';
import {
  CASTLE_INTERIOR_ANCHOR,
  DUNGEONS_BY_ID,
  dungeonExitHotspotPx,
  dungeonSpawnPx,
  dungeonUsesCastleInteriorNav,
  interiorLocalToPx,
  zoneEntranceToPx,
} from './helpers.js';
import { CASTLE_ASHWOOD_ENTRY } from '../content/dungeons/castleAshwood.generated.js';
import { contentPosToPx } from '../world/zones.js';
import { ZONES_BY_ID } from '../content/index.js';
import type { DungeonDef } from '../content/types.js';

const ashwood = DUNGEONS_BY_ID['castle_ashwood'];

describe('fixture sanity', () => {
  it('Castle Ashwood is registered and lives in zone 1', () => {
    expect(ashwood).toBeDefined();
    expect(ashwood.entrance.zoneId).toBe(1);
  });

  it('zone 2 is real, shipped content at a k*3000m offset (not something this file invents)', () => {
    const zone2 = ZONES_BY_ID[2];
    expect(zone2).toBeDefined();
    expect(zone2.originOffsetM).toEqual({ x: 3000, z: 0 });
  });
});

describe('interiorLocalToPx: byte-identical for Castle Ashwood (D173 item 2)', () => {
  /** Verbatim transcription of the retired pre-fix body — the oracle, not a guess. */
  function oldInteriorLocalToPx(local: { x: number; z: number }): { x: number; y: number } {
    return {
      x: Math.round((local.x + CASTLE_INTERIOR_ANCHOR.x) * 32 + 1600),
      y: Math.round((local.z + CASTLE_INTERIOR_ANCHOR.z) * 32 + 1600),
    };
  }

  it.each([
    { x: 0, z: 0 },
    CASTLE_ASHWOOD_ENTRY.spawnLocal,
    CASTLE_ASHWOOD_ENTRY.exitHotspotLocal,
    { x: 22.75, z: -17.5 }, // an interior mob spawn's local pos (ca_vault)
    { x: -24.5, z: -15.75 }, // ca_ballroom
  ])('matches the pre-fix oracle for local %o', (local) => {
    expect(interiorLocalToPx(ashwood, local)).toEqual(oldInteriorLocalToPx(local));
  });

  it('produces the expected literal px for the interior origin (840, 0) -> (28480, 1600)', () => {
    expect(interiorLocalToPx(ashwood, { x: 0, z: 0 })).toEqual({ x: 28480, y: 1600 });
  });
});

describe('dungeonSpawnPx / dungeonExitHotspotPx: byte-identical for Castle Ashwood (D174 items 1-2)', () => {
  it('dungeonSpawnPx(ashwood) matches the retired castleSpawnPx() output exactly', () => {
    expect(dungeonSpawnPx(ashwood)).toEqual({ x: 26996, y: 1600 });
  });

  it('dungeonExitHotspotPx(ashwood) matches the retired castleExitHotspotPx() output exactly', () => {
    expect(dungeonExitHotspotPx(ashwood)).toEqual({ x: 26772, y: 1600 });
  });

  it('zoneEntranceToPx(ashwood) is unchanged (already fixed by an earlier decision; regression guard)', () => {
    expect(zoneEntranceToPx(ashwood)).toEqual({ x: 5200, y: 2240 });
  });
});

describe('dungeonUsesCastleInteriorNav: gates on registered data, not a literal id compare (D174 item 3)', () => {
  it('is true for Castle Ashwood, the only dungeon with registered interior data', () => {
    expect(dungeonUsesCastleInteriorNav('castle_ashwood')).toBe(true);
  });

  it('is false for an unregistered dungeon id, instead of assuming every instance is Ashwood', () => {
    expect(dungeonUsesCastleInteriorNav('test_only_synthetic_2')).toBe(false);
    expect(dungeonUsesCastleInteriorNav('anything_unregistered')).toBe(false);
  });
});

describe('a synthetic non-Zone-1 dungeon resolves against ITS OWN zone (D173/D174, the actual regression proof)', () => {
  // Deliberately not 'barrowdeep' — the real Barrowdeep id is separate,
  // parallel content work (M11-5) this PR must not collide with. Zone 2
  // itself is real (content/zones/manifest.ts), only this DungeonDef is fake.
  const synthetic: DungeonDef = {
    id: 'test_only_synthetic_2',
    name: 'Test-Only Synthetic Dungeon (zone 2)',
    minLevel: 1,
    entrance: { zoneId: 2, pos: { x: 40, z: 12 } },
    layoutManifest: 'test_only_synthetic_2.json',
    bossMobType: 'test_only_boss',
    bossMechanics: {},
    spawns: [],
  };

  it('zoneEntranceToPx resolves the gate inside zone 2, not zone 1', () => {
    const px = zoneEntranceToPx(synthetic);
    expect(px).toEqual(contentPosToPx(2, { x: 40, z: 12 }));
    expect(px).toEqual({ x: 98880, y: 1984 });
    // What the pre-D156 "always zone 1" arithmetic would have produced for
    // the same entrance.pos — proves this is actually exercising zone 2,
    // not coincidentally reproducing zone 1's answer.
    expect(px).not.toEqual({ x: 2880, y: 1984 });
  });

  it('interiorLocalToPx resolves the interior inside zone 2 (D173 item 2 - the bug this PR fixes)', () => {
    const px = interiorLocalToPx(synthetic, { x: 0, z: 0 });
    // Falls back to Ashwood's anchor (840,0) since no interior entry is
    // registered for this id yet, but the ZONE is synthetic.entrance.zoneId
    // (2) — the axis D173 was actually about.
    expect(px).toEqual(contentPosToPx(2, { x: 840, z: 0 }));
    expect(px).toEqual({ x: 124480, y: 1600 });
    // The old bug's answer: zone 1's origin regardless of dungeon.entrance.zoneId.
    expect(px).not.toEqual({ x: 28480, y: 1600 });
    // And it must not land ~3km away inside zone 1's own accept box either
    // (zone 1's box is [-30368, 33568] on both axes per zoneBounds.test.js).
    expect(px.x).toBeGreaterThan(33568);
  });

  it('dungeonSpawnPx falls back to ITS OWN gate, not Ashwood\'s interior spawn (D174 item 1)', () => {
    const px = dungeonSpawnPx(synthetic);
    expect(px).toEqual(zoneEntranceToPx(synthetic));
    expect(px).toEqual({ x: 98880, y: 1984 });
    // Before D174's fix, index.ts's `dungeonId === 'castle_ashwood' ? ... :
    // gatePx` fallback already used gatePx for a non-Ashwood id, so this
    // specific value was already "right" by the old ternary's else-branch —
    // what D174 actually fixes is that this is now a per-DungeonDef lookup
    // instead of a literal compare. The meaningful regression guard is that
    // it is NOT Ashwood's spawn point:
    expect(px).not.toEqual({ x: 26996, y: 1600 });
  });

  it('dungeonExitHotspotPx falls back to ITS OWN gate, not Ashwood\'s exit hotspot in zone 1 (D174 item 2)', () => {
    const px = dungeonExitHotspotPx(synthetic);
    expect(px).toEqual(zoneEntranceToPx(synthetic));
    expect(px).toEqual({ x: 98880, y: 1984 });
    // This is the literal bug D174 item 2 described: leaving ANY dungeon
    // used to eject the player at Castle Ashwood's gate in zone 1.
    expect(px).not.toEqual({ x: 26772, y: 1600 });
  });

  it('is not registered for castle-interior nav, so movePlayer\'s branch will not check it against Ashwood\'s walls', () => {
    expect(dungeonUsesCastleInteriorNav(synthetic.id)).toBe(false);
  });
});
