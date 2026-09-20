/**
 * `validateContent`'s zone-box rules, exercised against a manifest that breaks
 * them. The shipping manifest has one zone, so the rules added for per-zone
 * bounds (D156) cannot fire on it — integrity.test.ts proves they stay quiet
 * there, and this file proves they are not simply inert.
 *
 * Why the rules exist: the server resolves an STDB px pair to a zone by asking
 * which zone's box contains it (spacetimedb/src/world/zones.ts). Two boxes
 * sharing a point makes that answer depend on manifest order, and a
 * non-positive extent makes a zone that no position can ever be inside.
 *
 * The manifest is mocked rather than extended with a real Zone 2 — a fake
 * entry in the real manifest would reach the exporter and the Unity client.
 * Zone 2 has since become real content, so the last block reaches past the
 * mock with vi.importActual and checks the SHIPPING pair against the same
 * rules, at Zone 2's raised 500 m extent (D175, M11-5).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../zones/manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../zones/manifest')>();
  // Zone 1 plus two synthetic neighbours — never the live list, so a real
  // zone 2 landing later cannot collide with the ids invented here.
  const base = actual.ZONES.find((z) => z.id === 1)!;
  const zones = [
    base,
    // 1500 m away with two default 1000 m half-extents: the boxes overlap by
    // 500 m on both axes.
    { ...base, id: 2, key: 'zone2_overlapping', originOffsetM: { x: 1500, z: 0 }, gates: [] },
    { ...base, id: 3, key: 'zone3_zero_extent', originOffsetM: { x: 9000, z: 9000 }, boundsHalfExtentM: 0, gates: [] },
  ];
  return {
    ...actual,
    ZONES: zones,
    ZONES_BY_ID: Object.fromEntries(zones.map((z) => [z.id, z])),
    getZone: (id: number) => zones.find((z) => z.id === id) ?? null,
  };
});

const { validateContent } = await import('../index');

describe('zone box validation', () => {
  const errors = validateContent();

  it('rejects overlapping playable boxes', () => {
    expect(errors.some((e) => /zone1 and zone zone2_overlapping: playable boxes overlap/.test(e)))
      .toBe(true);
  });

  it('rejects a non-positive boundsHalfExtentM', () => {
    expect(errors.some((e) => /zone3_zero_extent: boundsHalfExtentM must be > 0/.test(e)))
      .toBe(true);
  });

  it('does not flag a zone that is far enough away', () => {
    // Zone 3 sits 9000 m out — its box may be degenerate, but it must not also
    // be reported as overlapping anything.
    expect(errors.some((e) => /zone3_zero_extent.*overlap/.test(e))).toBe(false);
  });
});

describe('the SHIPPING pair, past the mock, at zone 2\'s raised extent', () => {
  // The rules above are proved non-inert against a broken manifest;
  // integrity.test.ts proves they stay quiet on the live one. This block is
  // the third thing neither covers: that the raise D175 performed (400 -> 500)
  // did not push zone 2's box into zone 1's. `validateContent` reads the
  // mocked list, so the check is done directly against the real numbers.
  it('zone 1 and zone 2 still have disjoint playable boxes at 500 m', async () => {
    const actual = await vi.importActual<typeof import('../zones/manifest')>('../zones/manifest');
    const { zoneBoxPx } = await vi.importActual<
      typeof import('../../../../../spacetimedb/src/world/zones')
    >('../../../../../spacetimedb/src/world/zones');

    const zone2 = actual.ZONES.find((z) => z.id === 2)!;
    expect(zone2.boundsHalfExtentM).toBe(500);

    const boxes = actual.ZONES.map(zoneBoxPx);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const overlap =
          a.minX <= b.maxX && b.minX <= a.maxX &&
          a.minY <= b.maxY && b.minY <= a.maxY;
        expect(overlap, `zone ${a.zoneId} and zone ${b.zoneId} boxes overlap`).toBe(false);
      }
    }
    // And every extent is positive, the other rule above.
    for (const z of actual.ZONES) {
      if (z.boundsHalfExtentM !== undefined) expect(z.boundsHalfExtentM).toBeGreaterThan(0);
    }
  });
});
