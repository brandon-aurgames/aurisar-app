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
 * The manifest is mocked rather than extended with a real Zone 2 — Zone 2's
 * content is a separate task, and a fake entry in the real manifest would
 * reach the exporter and the Unity client.
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
