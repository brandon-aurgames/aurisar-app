/**
 * D173 item 3: `worldMToPx`/`pxToWorldM` used to hardcode `m * 32 + 1600` /
 * `(px - 1600) / 32` — zone 1's origin — with no way to resolve against any
 * other zone. Both now take an optional `originOffsetM` (that axis's
 * component of the owning zone's originOffsetM), defaulting to 0 so every
 * existing call site (none of which pass it — Castle Ashwood is zone 1's
 * only dungeon) is byte-identical.
 *
 * Deliberately NOT routed through world/zones.ts's contentPosToPx: that
 * helper rounds, and these two feed the movePlayer hot path's sub-pixel
 * wall-slide math (castleInteriorResolveMove) — introducing rounding there
 * would be a real behavior change, not a refactor. See the doc comment on
 * pxToWorldM in surface.ts for the full reasoning.
 */
import { describe, expect, it } from 'vitest';
import { pxToWorldM, worldMToPx } from './surface.js';

describe('worldMToPx / pxToWorldM: default offset is byte-identical to the pre-fix formula (D173 item 3)', () => {
  it('worldMToPx(m) with no offset matches the retired m * 32 + 1600 exactly', () => {
    expect(worldMToPx(10)).toBe(10 * 32 + 1600);
    expect(worldMToPx(-46.375)).toBe(-46.375 * 32 + 1600);
    expect(worldMToPx(0)).toBe(1600);
  });

  it('pxToWorldM(px) with no offset matches the retired (px - 1600) / 32 exactly', () => {
    expect(pxToWorldM(1920)).toBe((1920 - 1600) / 32);
    expect(pxToWorldM(1600)).toBe(0);
  });

  it('an explicit offset of 0 is identical to omitting it', () => {
    expect(worldMToPx(123.5, 0)).toBe(worldMToPx(123.5));
    expect(pxToWorldM(4321, 0)).toBe(pxToWorldM(4321));
  });

  it('round-trips at the default (zone-1) offset', () => {
    for (const m of [0, 10, -46.375, 793.625, 1000]) {
      expect(pxToWorldM(worldMToPx(m))).toBeCloseTo(m, 10);
    }
  });
});

describe('a non-zero originOffsetM resolves against a real non-Zone-1 offset (infrastructure proof, D173 item 3)', () => {
  // Zone 2's real, shipped originOffsetM.x (content/zones/manifest.ts) — not
  // wired to any live call site yet (Castle Ashwood is zone 1's only
  // dungeon), but the parameter exists and computes correctly for when a
  // future non-zone-1 dungeon's own interior wrapper needs it.
  const ZONE_2_OFFSET_X = 3000;

  it('worldMToPx shifts by the offset, and disagrees with the zone-1 (default) answer', () => {
    expect(worldMToPx(10, ZONE_2_OFFSET_X)).toBe((10 + ZONE_2_OFFSET_X) * 32 + 1600);
    expect(worldMToPx(10, ZONE_2_OFFSET_X)).toBe(97920);
    expect(worldMToPx(10, ZONE_2_OFFSET_X)).not.toBe(worldMToPx(10));
  });

  it('pxToWorldM inverts worldMToPx at the same non-zero offset', () => {
    const px = worldMToPx(10, ZONE_2_OFFSET_X);
    expect(pxToWorldM(px, ZONE_2_OFFSET_X)).toBe(10);
    expect(pxToWorldM(px, ZONE_2_OFFSET_X)).toBe(pxToWorldM(worldMToPx(10)));
  });

  it('round-trips at a non-zero offset for several values', () => {
    for (const m of [0, 10, -46.375, 793.625, 1000]) {
      expect(pxToWorldM(worldMToPx(m, ZONE_2_OFFSET_X), ZONE_2_OFFSET_X)).toBeCloseTo(m, 10);
    }
  });
});
