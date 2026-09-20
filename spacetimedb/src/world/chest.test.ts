/**
 * D173 item 1: chestPosToPx used to fold every chest's position against
 * zone 1's origin unconditionally — its own doc comment admitted "origin
 * offset is zero" — and WorldChestDef had no zoneId field at all to say
 * otherwise. A Zone-2 chest placed through the old code would have sat
 * ~3 km away inside zone 1, and playerNearChest would never fire.
 *
 * This proves two things:
 *   1. Every real, committed Zone-1 chest (world_chests.json, emitted from
 *      zone1_world.json) resolves to (sub-pixel-)identical px through the
 *      new zone-aware chestPosToPx, and that the one intentional difference
 *      (contentPosToPx's Math.round, which the old formula never applied)
 *      cannot flip a playerNearChest verdict.
 *   2. A synthetic chest with an explicit non-1 zoneId resolves against
 *      THAT zone's real origin offset (zone 2, already-shipped content),
 *      not zone 1's — the actual D173 regression.
 */
import { describe, expect, it } from 'vitest';
import chestManifest from '../manifests/world_chests.json';
import { chestPosToPx, playerNearChest, type WorldChestDef } from './chest.js';
import { contentPosToPx } from '../world/zones.js';
import { ZONES_BY_ID } from '../content/index.js';

/** Verbatim transcription of the retired pre-fix body — the oracle, not a guess. */
function oldChestPosToPx(chest: { x: number; z: number }): { x: number; y: number } {
  return { x: chest.x * 32 + 1600, y: chest.z * 32 + 1600 };
}

describe('fixture sanity', () => {
  // M11-2 (D176) made the emitter per-zone: Zone-1 chests still carry no
  // zoneId (the documented default), but the manifest now also carries real
  // Zone-2 chests, each tagged explicitly. This replaces the pre-M11-2
  // snapshot ("none carry a zoneId yet") now that it is no longer true.
  it('the committed manifest has real Zone-1 chests with no zoneId', () => {
    const zone1Chests = (chestManifest.chests as WorldChestDef[]).filter((c) => c.zoneId === undefined);
    expect(zone1Chests.length).toBeGreaterThan(0);
  });

  it('the committed manifest also has real Zone-2 chests, explicitly tagged', () => {
    const zone2Chests = (chestManifest.chests as WorldChestDef[]).filter((c) => c.zoneId === 2);
    expect(zone2Chests.length).toBeGreaterThan(0);
    for (const c of zone2Chests) {
      expect(Number.isFinite(c.x)).toBe(true);
      expect(Number.isFinite(c.z)).toBe(true);
    }
  });

  it('zone 2 is real, shipped content at a k*3000m offset (not something this file invents)', () => {
    expect(ZONES_BY_ID[2]?.originOffsetM).toEqual({ x: 3000, z: 0 });
  });
});

describe('chestPosToPx: every real Zone-1 chest is unchanged within sub-pixel rounding (D173 item 1)', () => {
  // Scoped to the manifest's Zone-1 subset: oldChestPosToPx is the retired
  // zone-1-origin-only formula (D173), so comparing it against a Zone-2 chest
  // would compare against the wrong zone's origin by construction, not prove
  // anything about a regression. M11-2 (D176) made this an explicit filter
  // now that the manifest carries more than one zone's chests.
  const zone1Chests = (chestManifest.chests as WorldChestDef[]).filter((c) => c.zoneId === undefined);

  it('the Zone-1 subset used by these tests is non-empty', () => {
    expect(zone1Chests.length).toBeGreaterThan(0);
  });

  it('every chest in the committed manifest is within 0.5 px per axis of the pre-fix formula', () => {
    for (const chest of zone1Chests) {
      const before = oldChestPosToPx(chest);
      const after = chestPosToPx(chest);
      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5);
    }
  });

  it('a sub-0.5px shift can never flip playerNearChest (open range is 80 px)', () => {
    // The chest actually farthest from an integer px position in the live
    // manifest — the worst case for this run's rounding delta — probed by
    // maximizing |old - Math.round(old)| across both axes.
    let worst: WorldChestDef | null = null;
    let worstDelta = 0;
    for (const chest of zone1Chests) {
      const before = oldChestPosToPx(chest);
      const dx = Math.abs(before.x - Math.round(before.x));
      const dy = Math.abs(before.y - Math.round(before.y));
      const delta = Math.max(dx, dy);
      if (delta > worstDelta) { worstDelta = delta; worst = chest; }
    }
    expect(worst).not.toBeNull();
    const chest = worst as WorldChestDef;
    const before = oldChestPosToPx(chest);
    // A player standing at the OLD (unrounded) position must still read as
    // "near" the NEW (rounded) chest position — proving the open-chest
    // interaction cannot regress for any real chest in the manifest.
    expect(playerNearChest(before, chest)).toBe(true);
  });

  it('a chest with no zoneId at a clean (non-fractional) position is byte-identical, not just close', () => {
    const chest: WorldChestDef = { id: 1, x: 10, z: -5, seed: 1 };
    expect(chestPosToPx(chest)).toEqual(oldChestPosToPx(chest));
    expect(chestPosToPx(chest)).toEqual({ x: 1920, y: 1440 });
  });
});

describe('a chest with an explicit non-1 zoneId resolves against ITS OWN zone (the actual D173 regression proof)', () => {
  const zone2Chest: WorldChestDef = { id: 999999, x: 10, z: -5, seed: 1, zoneId: 2 };

  it('chestPosToPx resolves inside zone 2, not zone 1', () => {
    const px = chestPosToPx(zone2Chest);
    expect(px).toEqual(contentPosToPx(2, { x: 10, z: -5 }));
    expect(px).toEqual({ x: 97920, y: 1440 });
    // What the pre-fix "origin offset is zero" formula would have produced
    // for the identical x/z — proves this actually exercises zone 2, not a
    // coincidental match.
    expect(px).not.toEqual(oldChestPosToPx(zone2Chest));
    expect(px).not.toEqual({ x: 1920, y: 1440 });
  });

  it('playerNearChest requires standing in zone 2, not the zone-1-assumed spot', () => {
    const zone2Pos = chestPosToPx(zone2Chest); // {x: 97920, y: 1440}
    const zone1AssumedPos = oldChestPosToPx(zone2Chest); // {x: 1920, y: 1440}

    expect(playerNearChest(zone2Pos, zone2Chest)).toBe(true);
    // Before D173's fix, this chest's proximity would have been checked
    // against the zone-1-assumed position instead — nowhere near where a
    // zone-2 player actually stands, so the chest could never be opened.
    expect(playerNearChest(zone1AssumedPos, zone2Chest)).toBe(false);
  });
});
