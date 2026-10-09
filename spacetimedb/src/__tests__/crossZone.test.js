/**
 * M14-1 (D233) — `crossZone`: walking across the overworld seam.
 *
 * index.ts imports `spacetimedb/server`, which this root vitest run cannot
 * execute (see mobInsertColumns.test.js), so the reducer is a thin shell over
 * world/layout.ts and this file drives that module directly against the live
 * manifest (zone 2 laid out at (0,+340), region x -499..499, z -170..499
 * zone-local, D232):
 *   - `distanceToRegion` / `layoutZoneAt`, the base zone included;
 *   - every acceptance and rejection of `resolveSeamCrossing`, both directions;
 *   - the position written is the same layout point, and a 1 → 2 → 1 round
 *     trip comes home;
 *   - the rate floor's table plumbing against an in-memory fake;
 *   - a source-level check that index.ts wires the reducer, the private
 *     `seamCrossing` table and reachWaypoint's zone/outdoor guard as the
 *     bindings and the rehearsal expect.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ZONES_BY_ID } from '../content/index.js';
import { movementRestriction } from '../combat/auras.js';
import { ZONE_GATE_RANGE_PX } from '../world/travel.js';
import { contentPosToPx, resolveZone } from '../world/zones.js';
import {
  distanceToRegion,
  lastSeamCrossAtFor,
  layoutOfPx,
  layoutZoneAt,
  resolveSeamCrossing,
  SEAM_CROSSING_MIN_INTERVAL_MICROS,
  SEAM_RANGE_PX,
  stampSeamCrossing,
} from '../world/layout.js';

const PX_PER_M = 32;
const NOW = 1_800_000_000_000_000n; // arbitrary micros-since-epoch
const Z1 = 1;
const Z2 = 2;

/** A healthy row of `zoneId` standing at layout (x, z), in that zone's px. */
function rowAtLayout(zoneId, x, z, overrides = {}) {
  const off = ZONES_BY_ID[zoneId].layout.offsetM;
  const px = contentPosToPx(zoneId, { x: x - off.x, z: z - off.z });
  return { x: px.x, y: px.y, hp: 100, deadUntil: 0n, ...overrides };
}

/**
 * resolveSeamCrossing with every guard passing by default: a level-13 caller
 * (above both floors), outdoors, unblocked, never crossed before.
 */
function cross(row, rowZoneId, destZoneId, opts = {}) {
  const o = {
    level: 13, inDungeon: false, controlBlocked: false, lastCrossAt: 0n, now: NOW, ...opts,
  };
  return resolveSeamCrossing(
    row, rowZoneId, destZoneId, o.level, o.inDungeon, o.controlBlocked, o.lastCrossAt, o.now,
  );
}

/** Layout of an accepted crossing's written px, in the destination zone. */
function arrivalLayout(outcome) {
  expect(outcome.ok).toBe(true);
  return layoutOfPx(outcome.x, outcome.y, outcome.zoneId);
}

describe('fixture sanity: the live layout D232 describes', () => {
  it('zone 1 is the base, zone 2 sits at (0,+340) with the D232 region', () => {
    expect(ZONES_BY_ID[Z1].layout).toEqual({ offsetM: { x: 0, z: 0 } });
    expect(ZONES_BY_ID[Z2].layout).toEqual({
      offsetM: { x: 0, z: 340 },
      regionM: { minX: -499, maxX: 499, minZ: -170, maxZ: 499 },
    });
    expect(ZONES_BY_ID[Z1].levelBand[0]).toBe(1);
    expect(ZONES_BY_ID[Z2].levelBand[0]).toBe(7);
  });

  it('6 m tolerance (the gate range) and a 1 s rate floor', () => {
    expect(SEAM_RANGE_PX).toBe(6 * PX_PER_M);
    expect(SEAM_RANGE_PX).toBe(ZONE_GATE_RANGE_PX);
    expect(SEAM_CROSSING_MIN_INTERVAL_MICROS).toBe(1_000_000n);
  });
});

describe('distanceToRegion and layoutZoneAt', () => {
  it('base: 2 m from layout (0,172), 230 m from (0,400), 0 on base ground', () => {
    expect(distanceToRegion({ x: 0, z: 172 }, Z1)).toBe(2);
    expect(distanceToRegion({ x: 0, z: 400 }, Z1)).toBe(230);
    expect(distanceToRegion({ x: 0, z: 168 }, Z1)).toBe(0);
    expect(distanceToRegion({ x: 600, z: 400 }, Z1)).toBe(0);
    // Near a side edge the nearest base ground is sideways, not south.
    expect(distanceToRegion({ x: 495, z: 400 }, Z1)).toBe(4);
  });

  it('non-base: Euclidean distance to the region, 0 inside', () => {
    expect(distanceToRegion({ x: 0, z: 168 }, Z2)).toBe(2);
    expect(distanceToRegion({ x: 0, z: 172 }, Z2)).toBe(0);
    expect(distanceToRegion({ x: 502, z: 166 }, Z2)).toBe(5); // a 3-4-5 corner
    expect(distanceToRegion({ x: 0, z: 0 }, 99)).toBe(Infinity);
  });

  it('every layout point has one owner; the seam edge itself is zone 2 (closed region)', () => {
    expect(layoutZoneAt(0, 169.99)).toBe(Z1);
    expect(layoutZoneAt(0, 170)).toBe(Z2);
    expect(layoutZoneAt(0, 400)).toBe(Z2);
    expect(layoutZoneAt(499, 839)).toBe(Z2);
    expect(layoutZoneAt(499.01, 400)).toBe(Z1);
    expect(layoutZoneAt(0, 839.01)).toBe(Z1);
  });

  it('the two gates are one layout point on the seam', () => {
    const z1Gate = ZONES_BY_ID[Z1].gates.find((g) => g.id === 'z1_north_pass');
    const z2Gate = ZONES_BY_ID[Z2].gates.find((g) => g.id === 'z2_south_pass');
    const a = layoutOfPx(...Object.values(contentPosToPx(Z1, z1Gate.pos)), Z1);
    const b = layoutOfPx(...Object.values(contentPosToPx(Z2, z2Gate.pos)), Z2);
    expect(a).toEqual({ x: 0, z: 170 });
    expect(b).toEqual(a);
  });
});

describe('resolveSeamCrossing: accepted within 6 m, both directions', () => {
  it.each([
    ['1 -> 2, on the seam (0 m)', Z1, Z2, 0, 170],
    ['1 -> 2, 3 m short', Z1, Z2, 0, 167],
    ['1 -> 2, 6 m short (inclusive)', Z1, Z2, 0, 164],
    ['1 -> 2, 6 m east of the side edge', Z1, Z2, 505, 400],
    ['2 -> 1, already on base ground (0 m)', Z2, Z1, 0, 168],
    ['2 -> 1, 3 m inside the region', Z2, Z1, 0, 173],
    ['2 -> 1, 6 m inside the region (inclusive)', Z2, Z1, 0, 176],
  ])('%s', (_label, from, to, x, z) => {
    const out = cross(rowAtLayout(from, x, z), from, to);
    expect(out.ok).toBe(true);
    expect(out.zoneId).toBe(to);
    // Same layout point, written in the destination zone's px...
    expect(arrivalLayout(out)).toEqual({ x, z });
    // ...which resolveZone, the rule movePlayer applies, files under `to`.
    expect(resolveZone(out.x, out.y).zoneId).toBe(to);
  });

  it('the rehearsal case: a zone 1 row at local (0,172) lands on zone 2 local (0,-168)', () => {
    const out = cross(rowAtLayout(Z1, 0, 172), Z1, Z2);
    expect(out).toEqual({ ok: true, zoneId: Z2, ...contentPosToPx(Z2, { x: 0, z: -168 }) });
  });

  it('accepts level 1 into zone 1 (its floor) and level 7 into zone 2 (exactly its floor)', () => {
    expect(cross(rowAtLayout(Z2, 0, 172), Z2, Z1, { level: 1 }).ok).toBe(true);
    expect(cross(rowAtLayout(Z1, 0, 168), Z1, Z2, { level: 7 }).ok).toBe(true);
  });
});

describe('resolveSeamCrossing: every rejection', () => {
  const stun = { effectKind: 'stun', magnitude: 0, expiresAt: NOW + 1_000_000n };
  const root = { effectKind: 'root', magnitude: 0, expiresAt: NOW + 1_000_000n };
  const atSeam = rowAtLayout(Z1, 0, 168);

  it.each([
    ['dead (hp 0)', rowAtLayout(Z1, 0, 168, { hp: 0 }), Z1, Z2, {}, 'dead'],
    ['dead (respawn pending)', rowAtLayout(Z1, 0, 168, { deadUntil: NOW + 1n }), Z1, Z2, {}, 'dead'],
    ['stunned', atSeam, Z1, Z2, { controlBlocked: movementRestriction([stun], NOW).blocked }, 'movement-restricted'],
    ['rooted', atSeam, Z1, Z2, { controlBlocked: movementRestriction([root], NOW).blocked }, 'movement-restricted'],
    ['inside a dungeon instance', atSeam, Z1, Z2, { inDungeon: true }, 'indoors'],
    ['destination == current zone', atSeam, Z1, Z1, {}, 'same-zone'],
    ['a destination that is not an overworld zone', atSeam, Z1, 99, {}, 'not-overworld'],
    ['1 -> 2 from 6.5 m short', rowAtLayout(Z1, 0, 163.5), Z1, Z2, {}, 'out-of-range'],
    ['2 -> 1 from 6.5 m inside', rowAtLayout(Z2, 0, 176.5), Z2, Z1, {}, 'out-of-range'],
    ['1 -> 2 from 10 m short (the rehearsal case)', rowAtLayout(Z1, 0, 160), Z1, Z2, {}, 'out-of-range'],
    ['2 -> 1 from deep in zone 2 (230 m)', rowAtLayout(Z2, 0, 400), Z2, Z1, {}, 'out-of-range'],
    ['level 6 into zone 2', atSeam, Z1, Z2, { level: 6 }, 'level-too-low'],
    ['level 1 into zone 2', atSeam, Z1, Z2, { level: 1 }, 'level-too-low'],
    ['a second crossing 1 us inside 1 s', atSeam, Z1, Z2, { lastCrossAt: NOW - 999_999n }, 'too-soon'],
    ['a second crossing in the same instant', atSeam, Z1, Z2, { lastCrossAt: NOW }, 'too-soon'],
  ])('rejects: %s', (_label, row, from, to, opts, reason) => {
    expect(cross(row, from, to, opts)).toEqual({ ok: false, reason });
  });

  it('accepts again at exactly 1.0 s after the last crossing', () => {
    expect(cross(atSeam, Z1, Z2, { lastCrossAt: NOW - 1_000_000n }).ok).toBe(true);
  });

  it('an expired stun does not block', () => {
    const expired = { effectKind: 'stun', magnitude: 0, expiresAt: NOW };
    expect(cross(atSeam, Z1, Z2, { controlBlocked: movementRestriction([expired], NOW).blocked }).ok).toBe(true);
  });
});

describe('the layout position is preserved', () => {
  // Off-grid px, the way rows really sit after client claims (stored as f32).
  const rows = [
    [Z1, { x: 1600.37, y: 7104.9 }],    // zone 1 local (0.0116, 172.03)
    [Z1, { x: 13811.25, y: 7036.5 }],   // a stretch of the seam far east
    [Z2, { x: 97600.5, y: -3828.75 }],  // zone 2 local (0.016, -169.6)
    [Z2, { x: 81655.1, y: -3500.2 }],   // zone 2 near its west edge
  ];

  it.each(rows)('arrival layout == row layout ±1 px (zone %i)', (from, px) => {
    const to = from === Z1 ? Z2 : Z1;
    const before = layoutOfPx(px.x, px.y, from);
    expect(distanceToRegion(before, to) * PX_PER_M).toBeLessThanOrEqual(SEAM_RANGE_PX);
    const after = arrivalLayout(cross({ ...px, hp: 100, deadUntil: 0n }, from, to));
    expect(Math.abs(after.x - before.x) * PX_PER_M).toBeLessThanOrEqual(1);
    expect(Math.abs(after.z - before.z) * PX_PER_M).toBeLessThanOrEqual(1);
  });

  it('1 -> 2 -> 1 returns the original px ±1, a second apart', () => {
    for (const [from, px] of rows.filter(([zone]) => zone === Z1)) {
      const there = cross({ ...px, hp: 100, deadUntil: 0n }, from, Z2);
      const back = cross({ x: there.x, y: there.y, hp: 100, deadUntil: 0n }, Z2, Z1, {
        lastCrossAt: NOW, now: NOW + SEAM_CROSSING_MIN_INTERVAL_MICROS,
      });
      expect(back.ok).toBe(true);
      expect(back.zoneId).toBe(Z1);
      expect(Math.abs(back.x - px.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.y - px.y)).toBeLessThanOrEqual(1);
    }
  });

  it('the server jump is exactly the zones\' offset difference (3000 m east, 340 m south)', () => {
    const out = cross(rowAtLayout(Z1, 10, 172), Z1, Z2);
    const from = rowAtLayout(Z1, 10, 172);
    expect(out.x - from.x).toBe(3000 * PX_PER_M);
    expect(out.y - from.y).toBe(-340 * PX_PER_M);
  });
});

describe('rate-floor rows (the private seamCrossing table)', () => {
  function fakeTable() {
    const rows = new Map();
    return {
      rows,
      identity: {
        find: (id) => rows.get(id) ?? null,
        update: (row) => { rows.set(row.identity, row); },
      },
      insert: (row) => { rows.set(row.identity, row); },
    };
  }

  it('reads 0n with no row, inserts on the first crossing, updates afterwards, per identity', () => {
    const table = fakeTable();
    expect(lastSeamCrossAtFor(table, 'alice')).toBe(0n);
    stampSeamCrossing(table, 'alice', NOW);
    expect(lastSeamCrossAtFor(table, 'alice')).toBe(NOW);
    stampSeamCrossing(table, 'alice', NOW + 5n);
    expect(lastSeamCrossAtFor(table, 'alice')).toBe(NOW + 5n);
    expect(table.rows.size).toBe(1);
    expect(lastSeamCrossAtFor(table, 'bob')).toBe(0n);
  });
});

describe('index.ts wiring (the surface the bindings and the rehearsal see)', () => {
  const src = readFileSync(new URL('../index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const body = (name) => {
    const start = src.indexOf(`export const ${name} = spacetimedb.reducer(`);
    expect(start, name).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf('\n);\n', start));
  };

  it('declares crossZone(destZoneId: u8)', () => {
    expect(src).toContain('export const crossZone = spacetimedb.reducer(\n  { destZoneId: t.u8() },');
  });

  it('declares seamCrossing as a NEW private table: identity pk, lastCrossAt u64', () => {
    expect(src).toMatch(/seamCrossing: table\(\n {4}\{\},\n {4}\{\n {6}identity: +t\.identity\(\)\.primaryKey\(\),\n {6}lastCrossAt: +t\.u64\(\),/);
  });

  it('client bindings grow by one reducer and no table: 27 reducers, 15 public tables', () => {
    const reducers = [...src.matchAll(/^export const (\w+) = spacetimedb\.reducer\(/gm)].map((m) => m[1]);
    const scheduled = [...src.matchAll(/scheduled: \(\): any => (\w+)/g)].map((m) => m[1]);
    expect(reducers.filter((r) => !scheduled.includes(r))).toHaveLength(27);
    expect(reducers).toContain('crossZone');
    expect(src.match(/\{ public: true \}/g)).toHaveLength(15);
  });

  it('crossZone resolves every guard from stored state and writes only what D233 lists', () => {
    const b = body('crossZone');
    expect(b).toContain('const outcome = resolveSeamCrossing(');
    expect(b).toContain('player.zoneId,');
    expect(b).toContain('getPlayerLevel(ctx, identity),');
    expect(b).toContain('player.dungeonInstanceId !== 0n,');
    expect(b).toContain('movementRestriction(playerAuraRows(ctx, identity), now).blocked,');
    expect(b).toContain('lastSeamCrossAtFor(ctx.db.seamCrossing, identity),');
    expect(b).toContain('if (!outcome.ok) return;');
    expect(b).toContain('x: outcome.x,');
    expect(b).toContain('y: outcome.y,');
    // resolveZone, as every zoneId write (zoneBounds.test.js); the resolver
    // above already refuses a crossing it would not file under the destination.
    expect(b).toContain('zoneId: resolveZone(outcome.x, outcome.y).zoneId,');
    expect(b).toContain('lastMoveAt: now,');
    expect(b).toContain('stampSeamCrossing(ctx.db.seamCrossing, identity, now);');
    // isMoving unchanged (unlike travelToZone): the player is walking through.
    expect(b).not.toMatch(/isMoving:/);
  });

  it('reachWaypoint checks zone and outdoors before the range check (M13-3 carried)', () => {
    const b = body('reachWaypoint');
    const guard = b.indexOf('if (player.zoneId !== wp.zoneId || player.dungeonInstanceId !== 0n) return;');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(b.indexOf('if (!playerWithinWaypointRange(player, wp)) return;'));
  });

  it('travelToZone stays, unchanged in shape', () => {
    expect(src).toContain('export const travelToZone = spacetimedb.reducer(\n  { gateId: t.string() },');
  });
});
