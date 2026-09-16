/**
 * The zone origin-offset fix (D156), proved against a second zone.
 *
 * `dungeon/helpers.ts` computed a dungeon gate's px with
 *
 *     const ox = zoneId === 1 ? 0 : 0; // zone 1 origin for now
 *
 * — both branches zero, so the zone id was read and then thrown away and every
 * dungeon resolved against zone 1's origin. With one zone authored that bug is
 * invisible: zone 1's offset IS (0, 0), so the wrong answer and the right one
 * coincide. It only shows up against a zone that sits somewhere else.
 *
 * Zone 2's content does not exist yet (M10-2 authors it), so this file stands
 * a second zone up by mocking the zone manifest rather than by adding content
 * the rest of the repo would then have to carry. That also exercises the live
 * `resolveZone` export — the factory tests in zoneBounds.test.js cover the
 * arithmetic, this covers the wiring to the manifest.
 */
import { describe, expect, it, vi } from 'vitest';

/** k·3000 m — the offset manifest.ts's own comment commits zones 2+ to. */
const ZONE_2_OFFSET_M = 3000;
const ZONE_2_ORIGIN_PX = ZONE_2_OFFSET_M * 32 + 1600; // 97600

vi.mock('../../../../spacetimedb/src/content/zones/manifest.ts', async (importOriginal) => {
  const actual = await importOriginal();
  // Built from zone 1 plus one synthetic neighbour, not from the whole
  // manifest: once a real zone 2 is authored, appending to the live list would
  // put two entries with id 2 on the plane and make these expectations depend
  // on which one the resolver saw first.
  const zone1 = actual.ZONES.find((z) => z.id === 1);
  const zone2 = {
    ...zone1,
    id: 2,
    key: 'zone2',
    name: 'Test Zone Two',
    originOffsetM: { x: 3000, z: 0 },
    gates: [],
  };
  const zones = [zone1, zone2];
  return {
    ...actual,
    ZONES: zones,
    ZONES_BY_ID: Object.fromEntries(zones.map((z) => [z.id, z])),
    getZone: (id) => zones.find((z) => z.id === id) ?? null,
  };
});

const { contentPosToPx, resolveZone } = await import(
  '../../../../spacetimedb/src/world/zones.ts'
);
const { zoneEntranceToPx } = await import(
  '../../../../spacetimedb/src/dungeon/helpers.ts'
);

describe('contentPosToPx applies the zone origin from the manifest', () => {
  it('puts zone 1 at the world origin, unchanged', () => {
    expect(contentPosToPx(1, { x: 0, z: 0 })).toEqual({ x: 1600, y: 1600 });
    expect(contentPosToPx(1, { x: 10, z: -5 })).toEqual({ x: 1920, y: 1440 });
  });

  it('puts a zone at a k·3000 m offset at its own origin', () => {
    expect(contentPosToPx(2, { x: 0, z: 0 })).toEqual({ x: ZONE_2_ORIGIN_PX, y: 1600 });
    expect(contentPosToPx(2, { x: 10, z: -5 })).toEqual({ x: 97920, y: 1440 });
  });

  it('rounds, so it agrees with the px seedWorld writes into rows', () => {
    // vendors/helpers.ts's retired copy skipped this, leaving proximity checks
    // measuring against a fractional point the NPC row was never placed at.
    expect(contentPosToPx(1, { x: 0.01, z: 0.01 })).toEqual({ x: 1600, y: 1600 });
  });

  it('falls back to the origin for a zone that is not in the manifest', () => {
    // A reducer must not abort a transaction over content validateContent
    // already rejects at authoring time.
    expect(contentPosToPx(99, { x: 0, z: 0 })).toEqual({ x: 1600, y: 1600 });
  });
});

describe('zoneEntranceToPx no longer collapses every zone onto zone 1', () => {
  const entranceIn = (zoneId, pos = { x: 0, z: 0 }) => ({ entrance: { zoneId, pos } });

  it('a zone-1 dungeon gate is byte-identical to before', () => {
    expect(zoneEntranceToPx(entranceIn(1, { x: 40, z: 12 })))
      .toEqual({ x: 2880, y: 1984 });
  });

  it('a zone-2 dungeon gate lands in zone 2, not 3000 m away in zone 1', () => {
    const px = zoneEntranceToPx(entranceIn(2, { x: 40, z: 12 }));
    expect(px).toEqual({ x: ZONE_2_ORIGIN_PX + 40 * 32, y: 1984 });
    // What the `zoneId === 1 ? 0 : 0` version returned for the same input.
    expect(px).not.toEqual({ x: 2880, y: 1984 });
  });
});

describe('resolveZone reads the live manifest', () => {
  it('owns both zones and reports each one by its content id', () => {
    expect(resolveZone(1600, 1600)).toMatchObject({ zoneId: 1, inBounds: true });
    expect(resolveZone(ZONE_2_ORIGIN_PX, 1600)).toMatchObject({ zoneId: 2, inBounds: true });
  });

  it('keeps the two boxes disjoint, with the gap owned by neither', () => {
    const between = resolveZone(49600, 1600);
    expect(between.inBounds).toBe(false);
    expect(between.x).not.toBe(49600);
  });
});
