/**
 * Per-zone world bounds and px → zone resolution (D156 / D157).
 *
 * `resolveZone` replaced two mechanisms at once: the single global ±1000 m
 * movement clamp (`WORLD_MIN_PX` / `WORLD_MAX_PX`) and `detectZone`'s four
 * hardcoded hub/training/plaza/wilderness pixel rectangles. The first half of
 * this file is therefore a regression suite, not a feature suite: with only
 * zone 1 defined — the state that ships today — the new accept region must be
 * the retired box to the pixel, or players who move legally now get dragged.
 *
 * Pure arithmetic, so it tests directly; no reducer harness needed, same as
 * moveGuard.test.js.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ZONE_HALF_EXTENT_M,
  PLAYER_HALF_PX,
  WORLD_ORIGIN_PX,
  makeZoneResolver,
  resolveZone,
  zoneBoxPx,
} from '../../../../spacetimedb/src/world/zones.ts';
import { ZONES } from '../content/index.ts';

const repoRoot = join(import.meta.dirname, '../../../..');

/** The constants this change retired, restated so the regression is explicit. */
const OLD_WORLD_MIN_PX = -30368;
const OLD_WORLD_MAX_PX = 33568;
const oldClamp = (v) => Math.max(OLD_WORLD_MIN_PX, Math.min(OLD_WORLD_MAX_PX, v));

const ZONE_1 = ZONES.find((z) => z.id === 1);

/**
 * A resolver over zone 1 alone. The "is this still the old clamp" assertions
 * are statements about ZONE 1's box, not about whatever the manifest happens
 * to hold — pinning them to the live resolver would make them start failing
 * the day zone 2 is authored, for a reason that is not a regression.
 */
const resolveZone1Only = makeZoneResolver([ZONE_1]);

/** The zone ids detectZone used to return, for the positions that produced them. */
const LEGACY_DETECT_ZONE_CASES = [
  { px: [1600, 1600], legacy: 0, name: 'hub rectangle' },
  { px: [600, 600], legacy: 1, name: 'training rectangle' },
  { px: [2600, 2600], legacy: 2, name: 'plaza rectangle' },
  { px: [20000, 20000], legacy: 3, name: 'wilderness' },
];

describe('zone 1 bounds are the retired global clamp, exactly', () => {
  it('computes the same box the constants hardcoded', () => {
    const box = zoneBoxPx({ id: 1, originOffsetM: { x: 0, z: 0 } });
    expect(box.minX).toBe(OLD_WORLD_MIN_PX);
    expect(box.maxX).toBe(OLD_WORLD_MAX_PX);
    expect(box.minY).toBe(OLD_WORLD_MIN_PX);
    expect(box.maxY).toBe(OLD_WORLD_MAX_PX);
    // ...and the derivation is still the documented one.
    expect(box.maxX - box.centerX).toBe(
      DEFAULT_ZONE_HALF_EXTENT_M * 32 - PLAYER_HALF_PX,
    );
  });

  it('the shipping manifest still puts zone 1 on that box', () => {
    // Guards the case where someone gives zone 1 a boundsHalfExtentM or moves
    // its origin: either would silently change what movePlayer accepts.
    expect(ZONE_1, 'zone 1 must exist in the manifest').toBeDefined();
    const box = zoneBoxPx(ZONE_1);
    expect([box.minX, box.maxX, box.minY, box.maxY]).toEqual([
      OLD_WORLD_MIN_PX, OLD_WORLD_MAX_PX, OLD_WORLD_MIN_PX, OLD_WORLD_MAX_PX,
    ]);
  });

  it('accepts every position the old clamp accepted, unchanged', () => {
    const inside = [
      [WORLD_ORIGIN_PX, WORLD_ORIGIN_PX],
      [0, 0],
      [OLD_WORLD_MIN_PX, OLD_WORLD_MIN_PX],   // the corners are inclusive
      [OLD_WORLD_MAX_PX, OLD_WORLD_MAX_PX],
      [OLD_WORLD_MIN_PX, OLD_WORLD_MAX_PX],
      [-12345.5, 6789.25],                    // f32 positions are not integers
    ];
    for (const [x, y] of inside) {
      // Asserted against the LIVE resolver: zone boxes are disjoint, so a
      // point inside zone 1 stays zone 1 no matter what else is authored.
      const r = resolveZone(x, y);
      expect(r.inBounds, `(${x}, ${y}) must stay in bounds`).toBe(true);
      expect(r.zoneId).toBe(1);
      expect(r.x).toBe(x);
      expect(r.y).toBe(y);
    }
  });

  it('clamps every out-of-bounds claim to the old effective result', () => {
    // The R1 pin: sweep across and well past both edges on both axes and
    // require the new resolver to land exactly where the old two-line clamp
    // would have. A wider accept region must never reject, and a narrower one
    // must never appear.
    const sweep = [
      -1e6, -100000, -30369, -30368, -30367, -1000, 0, 1600,
      33567, 33568, 33569, 97600, 100000, 1e6,
    ];
    for (const x of sweep) {
      for (const y of sweep) {
        const r = resolveZone1Only(x, y);
        expect(r.x, `x at (${x}, ${y})`).toBe(oldClamp(x));
        expect(r.y, `y at (${x}, ${y})`).toBe(oldClamp(y));
        expect(r.inBounds).toBe(x === oldClamp(x) && y === oldClamp(y));
      }
    }
  });

  it('never writes a non-finite position into the row', () => {
    // The old clamp propagated NaN straight through (Math.min/Math.max of NaN
    // is NaN), so a spoofed claim could land an uncomparable coordinate in a
    // public row. Out of bounds at a zone centre instead — the speed guard
    // downstream then walks the row there rather than teleporting it.
    const ids = new Set(ZONES.map((z) => z.id));
    for (const [x, y] of [[NaN, 0], [0, NaN], [Infinity, Infinity]]) {
      const r = resolveZone(x, y);
      expect(Number.isFinite(r.x)).toBe(true);
      expect(Number.isFinite(r.y)).toBe(true);
      expect(r.inBounds).toBe(false);
      expect(ids.has(r.zoneId)).toBe(true);
    }
  });
});

describe('zoneId is the content ZoneDef.id, not the legacy rectangles', () => {
  it.each(LEGACY_DETECT_ZONE_CASES)(
    'the old $name (zone $legacy) now resolves to content zone 1',
    ({ px, legacy }) => {
      const r = resolveZone(px[0], px[1]);
      expect(r.zoneId).toBe(1);
      // Only meaningful while the legacy answer differed; kept so the case
      // list documents what each position used to produce.
      if (legacy !== 1) expect(r.zoneId).not.toBe(legacy);
    },
  );

  it('every position on the plane resolves to a defined zone id', () => {
    // detectZone could answer 0, 2 or 3 for a position in zone 1 — none of
    // which is a ZoneDef.id at all. Whatever the manifest holds, every point
    // on the plane must now map to a zone that actually exists.
    const ids = new Set(ZONES.map((z) => z.id));
    for (const x of [-1e6, -30368, 0, 1600, 33568, 97600, 1e6]) {
      for (const y of [-1e6, 0, 1600, 33568, 1e6]) {
        expect(ids.has(resolveZone(x, y).zoneId)).toBe(true);
      }
    }
  });
});

describe('zone 2 at its shipped 500 m extent (D175)', () => {
  // Unlike the synthetic block below, these read the LIVE manifest. Zone 2's
  // boundsHalfExtentM rose 400 -> 500 in M11-5 to host the Barrowdeep's
  // interior at zone-local {x: 430, z: 0}; manifest.ts's own header warns that
  // moving a zone's extent "changes what movePlayer accepts — it is not
  // cosmetic data", which is why the raise and these assertions are required
  // to land in the same PR.
  const ZONE_2_LIVE = ZONES.find((z) => z.id === 2);
  const BARROWDEEP_ANCHOR_X = 430;
  const BARROWDEEP_LOCAL_X1 = 44; // barrowdeepPlan LOCAL_BOUNDS.x1

  it('claims exactly 500 m, not the 400 m it shipped with', () => {
    expect(ZONE_2_LIVE, 'zone 2 must exist in the manifest').toBeDefined();
    expect(ZONE_2_LIVE.boundsHalfExtentM).toBe(500);
    const box = zoneBoxPx(ZONE_2_LIVE);
    expect(box.maxX - box.centerX).toBe(500 * 32 - PLAYER_HALF_PX);
    // The x span D175 quotes. The z span is centred on the world origin
    // instead, because zone 2's originOffsetM.z is 0.
    expect([box.minX, box.maxX]).toEqual([81632, 113568]);
    expect([box.minY, box.maxY]).toEqual([-14368, 17568]);
  });

  it('accepts the whole Barrowdeep interior footprint, which 400 m did not', () => {
    const box = zoneBoxPx(ZONE_2_LIVE);
    const farEdgePx = (3000 + BARROWDEEP_ANCHOR_X + BARROWDEEP_LOCAL_X1) * 32 + WORLD_ORIGIN_PX;
    const r = resolveZone(farEdgePx, WORLD_ORIGIN_PX);
    expect(r.zoneId).toBe(2);
    expect(r.inBounds, 'the interior\'s far edge must be walkable ground').toBe(true);
    expect(r.x).toBe(farEdgePx);
    // 25 m of margin, the figure D175 commits to.
    expect((box.maxX - farEdgePx) / 32).toBe(25);
    // The counterfactual, stated as an assertion so the reason for the raise
    // cannot quietly stop being true: at 400 m the same point was clamped.
    const old400 = zoneBoxPx({ ...ZONE_2_LIVE, boundsHalfExtentM: 400 });
    expect(farEdgePx).toBeGreaterThan(old400.maxX);
  });

  it('still keeps its box inside the baked terrain, and clear of zone 1', () => {
    // ZoneGrid's zone 2 descriptor bakes 4 tiles x 256 m from origin -512, so
    // 500 < 512 preserves the "playable box inside the terrain" invariant that
    // widening to zone 1's 1000 m default would have broken.
    expect(ZONE_2_LIVE.boundsHalfExtentM).toBeLessThan(512);
    const z1 = zoneBoxPx(ZONES.find((z) => z.id === 1));
    const z2 = zoneBoxPx(ZONE_2_LIVE);
    expect(z2.minX).toBeGreaterThan(z1.maxX);
    // The gap between the two boxes belongs to neither, exactly as before.
    const mid = (z1.maxX + z2.minX) / 2;
    expect(resolveZone(mid, WORLD_ORIGIN_PX).inBounds).toBe(false);
  });

  it('leaves zone 1\'s accept region untouched', () => {
    for (const x of [OLD_WORLD_MIN_PX, 0, WORLD_ORIGIN_PX, OLD_WORLD_MAX_PX]) {
      const r = resolveZone(x, WORLD_ORIGIN_PX);
      expect(r.zoneId).toBe(1);
      expect(r.inBounds).toBe(true);
      expect(r.x).toBe(x);
    }
  });
});

describe('a second zone at a k·3000 m offset', () => {
  // Synthetic on purpose: the "is this still the old clamp" reasoning below is
  // a statement about the resolver's ARITHMETIC, not about whatever the
  // manifest happens to hold, so it must not move when zone 2's real extent
  // does (it already has once — 400 -> 500, D175). The live manifest gets its
  // own block above.
  const ZONE_1 = { id: 1, originOffsetM: { x: 0, z: 0 } };
  const ZONE_2 = { id: 2, originOffsetM: { x: 3000, z: 0 } };
  const resolve = makeZoneResolver([ZONE_1, ZONE_2]);
  const z2 = zoneBoxPx(ZONE_2);

  it('is in bounds at its own origin — the position the old clamp refused', () => {
    // 3000 m → px 97600, which the retired ±1000 m box clamped back to 33568:
    // every zone-2 player was yanked to the zone-1 boundary on their first move.
    expect(z2.centerX).toBe(97600);
    const r = resolve(97600, WORLD_ORIGIN_PX);
    expect(r).toEqual({ zoneId: 2, inBounds: true, x: 97600, y: WORLD_ORIGIN_PX });
  });

  it('leaves zone 1 exactly as it was', () => {
    for (const x of [-30368, 0, 1600, 33568]) {
      const r = resolve(x, WORLD_ORIGIN_PX);
      expect(r.zoneId).toBe(1);
      expect(r.inBounds).toBe(true);
      expect(r.x).toBe(x);
    }
  });

  it('claims the inter-zone gap for neither zone, and clamps to the nearer one', () => {
    // The gap is the reason the global box was not simply widened: a single
    // rectangle spanning both zones would call this dead ground "in bounds"
    // while no zone owns it.
    const nearOne = resolve(40000, WORLD_ORIGIN_PX);
    expect(nearOne.inBounds).toBe(false);
    expect(nearOne.zoneId).toBe(1);
    expect(nearOne.x).toBe(OLD_WORLD_MAX_PX);

    const nearTwo = resolve(60000, WORLD_ORIGIN_PX);
    expect(nearTwo.inBounds).toBe(false);
    expect(nearTwo.zoneId).toBe(2);
    expect(nearTwo.x).toBe(z2.minX);
  });

  it('honours a per-zone boundsHalfExtentM', () => {
    const small = zoneBoxPx({ id: 2, originOffsetM: { x: 3000, z: 0 }, boundsHalfExtentM: 500 });
    expect(small.maxX - small.centerX).toBe(500 * 32 - PLAYER_HALF_PX);
    const tight = makeZoneResolver([ZONE_1, { ...ZONE_2, boundsHalfExtentM: 500 }]);
    expect(tight(z2.maxX, WORLD_ORIGIN_PX).inBounds).toBe(false);
    expect(tight(small.maxX, WORLD_ORIGIN_PX).inBounds).toBe(true);
  });

  it('degrades safely when the manifest has no zones at all', () => {
    expect(makeZoneResolver([])(500, 500)).toEqual({
      zoneId: 0, inBounds: false, x: 500, y: 500,
    });
  });
});

describe('the server module actually uses it', () => {
  const server = readFileSync(join(repoRoot, 'spacetimedb/src/index.ts'), 'utf8');
  const dungeonHelpers = readFileSync(
    join(repoRoot, 'spacetimedb/src/dungeon/helpers.ts'), 'utf8',
  );
  const vendorHelpers = readFileSync(
    join(repoRoot, 'spacetimedb/src/vendors/helpers.ts'), 'utf8',
  );

  /** Body of the reducer starting at `anchor`, up to the closing `});`. */
  const blockAfter = (anchor) => {
    const at = server.indexOf(anchor);
    expect(at, `anchor not found: ${anchor}`).toBeGreaterThan(-1);
    return server.slice(at, server.indexOf('});', at));
  };

  it('both retired mechanisms are gone from the module', () => {
    // Matched as code, not as prose — the comments that replaced them name
    // both by name on purpose.
    expect(server).not.toMatch(/function detectZone/);
    expect(server).not.toMatch(/detectZone\(/);
    expect(server).not.toMatch(/Math\.max\(WORLD_MIN_PX/);
    expect(server).not.toMatch(/^const WORLD_(MIN|MAX|HALF)_PX/m);
  });

  it('movePlayer bounds the claim and re-resolves the zone after the guards', () => {
    const body = blockAfter('export const movePlayer');
    expect(body).toContain('const bounded = resolveZone(x, y);');
    // The zone written to the row must come from the position actually stored:
    // the speed guard and the castle-interior resolver both move the point
    // after the bounds pass.
    expect(body).toContain('resolveZone(clampedX, clampedY).zoneId');
  });

  it('every path that writes zoneId writes a content zone id', () => {
    // Four reducers write this column (setPlayerInfo's insert, enterDungeon,
    // leaveDungeon, respawnPlayer) plus movePlayer's local. A literal here —
    // setPlayerInfo used to hardcode `zoneId: 0`, the legacy hub — is the
    // regression this catches.
    const writes = (server.match(/zoneId:\s*[^,\n]+/g) ?? [])
      .filter((w) => !w.includes('t.u8()'));
    expect(writes.length).toBeGreaterThanOrEqual(4);
    for (const w of writes) {
      expect(w, `zoneId write not sourced from resolveZone: ${w}`).toContain('resolveZone(');
    }
  });

  it('player.zoneId is indexed', () => {
    expect(server).toMatch(/zoneId:\s+t\.u8\(\)\.index\('btree'\)/);
  });

  it('the origin-offset math has exactly one implementation', () => {
    // dungeon/helpers.ts hardcoded `zoneId === 1 ? 0 : 0` and vendors/helpers.ts
    // kept a third, unrounded copy. Both now defer to world/zones.ts.
    expect(dungeonHelpers).not.toMatch(/^\s*const o[xz] = /m);
    expect(dungeonHelpers).toMatch(/return contentPosToPx\(zoneId, pos\);/);
    expect(vendorHelpers).toMatch(/import \{ contentPosToPx \} from '\.\.\/world\/zones\.js';/);
    expect(vendorHelpers).not.toMatch(/function contentPosToPx/);
    expect(server).not.toMatch(/function contentPosToPx/);
  });
});
