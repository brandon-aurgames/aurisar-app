/**
 * M12-6 (D189) — waypoint discovery and fast travel, server side.
 *
 * index.ts imports `spacetimedb/server`, which this root vitest run cannot
 * execute (see __tests__/mobInsertColumns.test.js), so the reducers are thin
 * shells over world/fastTravel.ts and this file drives that module directly:
 *   - every rejection of `resolveDiscoverWaypoint` and `resolveFastTravel`;
 *   - same-zone and cross-zone success, with the stored zoneId re-derived via
 *     resolveZone exactly as the reducer does;
 *   - repeat discovery is idempotent, and the cooldown stamp upserts, against
 *     in-memory fakes of the two new tables;
 *   - `reachWaypoint`'s range check is unchanged: the extracted
 *     `playerWithinWaypointRange` agrees with a verbatim transcription of the
 *     retired inline arithmetic on every real waypoint;
 *   - a source-level check that index.ts wires the reducers and tables with
 *     the exact names/shapes M12-7's bindings will be generated from.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_WAYPOINTS, WAYPOINTS, ZONES_BY_ID } from '../content/index.js';
import { movementRestriction } from '../combat/auras.js';
import { contentPosToPx, resolveZone } from './zones.js';
import { resolveGateTravel } from './travel.js';
import {
  FAST_TRAVEL_COMBAT_LOCKOUT_MICROS,
  FAST_TRAVEL_COOLDOWN_MICROS,
  hasDiscoveredWaypoint,
  lastFastTravelAtFor,
  playerWithinWaypointRange,
  recordWaypointDiscovery,
  resolveDiscoverWaypoint,
  resolveFastTravel,
  stampFastTravel,
  WAYPOINT_RANGE_TOLERANCE_M,
} from './fastTravel.js';

const PX_PER_M = 32;
const NOW = 1_800_000_000_000_000n; // arbitrary micros-since-epoch

const Z1_WP = 'poi_oakrest';      // zone 1 (levelBand [1, 7])
const Z1_WP_2 = 'poi_stillmere';  // zone 1
const Z2_WP = 'poi_kestrel_hold'; // zone 2 (levelBand [7, 14])

/** A healthy, outdoor player standing exactly on `waypointId`. */
function playerAt(waypointId, overrides = {}) {
  const wp = WAYPOINTS[waypointId];
  const px = contentPosToPx(wp.zoneId, wp.pos);
  return {
    x: px.x,
    y: px.y,
    zoneId: wp.zoneId,
    hp: 100,
    deadUntil: 0n,
    dungeonInstanceId: 0n,
    lastAttackAt: 0n,
    ...overrides,
  };
}

function travelInput(overrides = {}) {
  return {
    player: playerAt(Z1_WP),
    waypointId: Z1_WP_2,
    nowMicros: NOW,
    movementBlocked: false,
    discovered: true,
    playerLevel: 1,
    lastFastTravelAt: 0n,
    ...overrides,
  };
}

/** Verbatim transcription of reachWaypoint's retired inline check — the oracle. */
function oldReachWaypointInRange(player, wp) {
  const px = contentPosToPx(wp.zoneId, wp.pos);
  const rangePx = (wp.radiusM + 2) * PX_PER_M;
  const dx = player.x - px.x;
  const dy = player.y - px.y;
  return !(dx * dx + dy * dy > rangePx * rangePx);
}

describe('fixture sanity', () => {
  it('uses real, shipped content', () => {
    expect(WAYPOINTS[Z1_WP].zoneId).toBe(1);
    expect(WAYPOINTS[Z1_WP_2].zoneId).toBe(1);
    expect(WAYPOINTS[Z2_WP].zoneId).toBe(2);
    expect(ZONES_BY_ID[1].levelBand[0]).toBe(1);
    expect(ZONES_BY_ID[2].levelBand[0]).toBe(7);
    expect(WAYPOINT_RANGE_TOLERANCE_M).toBe(2);
    expect(FAST_TRAVEL_COMBAT_LOCKOUT_MICROS).toBe(10_000_000n);
    expect(FAST_TRAVEL_COOLDOWN_MICROS).toBe(60_000_000n);
  });
});

describe('playerWithinWaypointRange: reachWaypoint behaviour unchanged', () => {
  it('agrees with the retired inline check on every real waypoint, around the edge', () => {
    let checked = 0;
    for (const wp of ALL_WAYPOINTS) {
      const c = contentPosToPx(wp.zoneId, wp.pos);
      const r = (wp.radiusM + 2) * PX_PER_M;
      const offsets = [0, 1, r - 1, r - 0.5, r, r + 0.5, r + 1, 2 * r];
      for (const d of offsets) {
        for (const [ux, uy] of [[1, 0], [0, -1], [Math.SQRT1_2, Math.SQRT1_2], [-0.6, 0.8]]) {
          const p = { x: c.x + ux * d, y: c.y + uy * d };
          expect(playerWithinWaypointRange(p, wp)).toBe(oldReachWaypointInRange(p, wp));
          checked++;
        }
      }
    }
    expect(checked).toBe(ALL_WAYPOINTS.length * 8 * 4);
  });

  it('is inclusive at radiusM + 2 m and exclusive just past it', () => {
    const wp = WAYPOINTS[Z1_WP];
    const c = contentPosToPx(wp.zoneId, wp.pos);
    const r = (wp.radiusM + 2) * PX_PER_M;
    expect(playerWithinWaypointRange({ x: c.x + r, y: c.y }, wp)).toBe(true);
    expect(playerWithinWaypointRange({ x: c.x + r + 1, y: c.y }, wp)).toBe(false);
  });

  it('reachWaypoint in index.ts now calls the shared check instead of inlining it', () => {
    const src = readFileSync(new URL('../index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('export const reachWaypoint = spacetimedb.reducer(');
    const end = src.indexOf('\n);\n', start);
    const body = src.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('{ questId: t.string(), objectiveIdx: t.u32() }');
    expect(body).toContain('if (!playerWithinWaypointRange(player, wp)) return;');
    expect(body).not.toContain('rangePx');
  });
});

describe('resolveDiscoverWaypoint', () => {
  it('accepts a live, outdoor player standing at a waypoint of their zone', () => {
    const out = resolveDiscoverWaypoint(playerAt(Z1_WP), Z1_WP, NOW);
    expect(out).toEqual({ ok: true, waypoint: WAYPOINTS[Z1_WP] });
  });

  it('accepts at the radiusM + 2 m edge (the reachWaypoint tolerance)', () => {
    const wp = WAYPOINTS[Z2_WP];
    const edge = (wp.radiusM + 2) * PX_PER_M;
    const p = playerAt(Z2_WP);
    expect(resolveDiscoverWaypoint({ ...p, x: p.x + edge }, Z2_WP, NOW).ok).toBe(true);
  });

  it.each([
    ['unknown waypoint', playerAt(Z1_WP), 'poi_does_not_exist', 'no-such-waypoint'],
    ['dead (hp 0)', playerAt(Z1_WP, { hp: 0 }), Z1_WP, 'dead'],
    ['dead (respawn pending)', playerAt(Z1_WP, { deadUntil: NOW + 1n }), Z1_WP, 'dead'],
    ['indoors (dungeon instance)', playerAt(Z1_WP, { dungeonInstanceId: 7n }), Z1_WP, 'indoors'],
    ['wrong zone', playerAt(Z1_WP), Z2_WP, 'wrong-zone'],
  ])('rejects: %s', (_label, player, waypointId, reason) => {
    expect(resolveDiscoverWaypoint(player, waypointId, NOW)).toEqual({ ok: false, reason });
  });

  it('rejects: out of radius (one px past radiusM + 2 m)', () => {
    const wp = WAYPOINTS[Z1_WP];
    const p = playerAt(Z1_WP);
    const past = (wp.radiusM + 2) * PX_PER_M + 1;
    expect(resolveDiscoverWaypoint({ ...p, y: p.y + past }, Z1_WP, NOW))
      .toEqual({ ok: false, reason: 'out-of-range' });
  });

  it('rejects wrong zone even when the zone-local coordinates coincide', () => {
    // A zone-1 player at zone 2 waypoint's zone-LOCAL pos (no offset) is ~3 km away
    // in px and in the wrong zone; wrong-zone is reported first.
    const wp = WAYPOINTS[Z2_WP];
    const px = contentPosToPx(1, wp.pos);
    const p = { ...playerAt(Z1_WP), x: px.x, y: px.y, zoneId: 1 };
    expect(resolveDiscoverWaypoint(p, Z2_WP, NOW)).toEqual({ ok: false, reason: 'wrong-zone' });
  });
});

/** In-memory `playerWaypoint`: filter by owner, autoinc id. */
function fakeWaypointTable() {
  const rows = [];
  let next = 1n;
  return {
    rows,
    owner: { filter: (owner) => rows.filter((r) => r.owner === owner) },
    insert(row) {
      const stored = { ...row, id: next++ };
      rows.push(stored);
      return stored;
    },
  };
}

/** In-memory `playerTravelState` keyed by identity. */
function fakeTravelStateTable() {
  const rows = new Map();
  return {
    rows,
    identity: {
      find: (id) => rows.get(id) ?? null,
      update: (row) => { rows.set(row.identity, row); return row; },
    },
    insert(row) {
      if (rows.has(row.identity)) throw new Error('duplicate primary key');
      rows.set(row.identity, row);
      return row;
    },
  };
}

describe('discovery rows: insert once', () => {
  it('a repeat discovery is idempotent (one row, first timestamp kept)', () => {
    const table = fakeWaypointTable();
    expect(recordWaypointDiscovery(table, 'alice', Z1_WP, NOW)).toBe(true);
    expect(recordWaypointDiscovery(table, 'alice', Z1_WP, NOW + 5_000_000n)).toBe(false);
    expect(table.rows).toEqual([{ id: 1n, owner: 'alice', waypointId: Z1_WP, discoveredAt: NOW }]);
  });

  it('is per owner and per waypoint', () => {
    const table = fakeWaypointTable();
    recordWaypointDiscovery(table, 'alice', Z1_WP, NOW);
    expect(recordWaypointDiscovery(table, 'bob', Z1_WP, NOW)).toBe(true);
    expect(recordWaypointDiscovery(table, 'alice', Z2_WP, NOW)).toBe(true);
    expect(table.rows).toHaveLength(3);
    expect(hasDiscoveredWaypoint(table, 'alice', Z2_WP)).toBe(true);
    expect(hasDiscoveredWaypoint(table, 'bob', Z2_WP)).toBe(false);
  });
});

describe('cooldown stamp', () => {
  it('reads 0n with no row, inserts on first travel, updates afterwards', () => {
    const table = fakeTravelStateTable();
    expect(lastFastTravelAtFor(table, 'alice')).toBe(0n);
    stampFastTravel(table, 'alice', NOW);
    expect(lastFastTravelAtFor(table, 'alice')).toBe(NOW);
    stampFastTravel(table, 'alice', NOW + 61_000_000n);
    expect(lastFastTravelAtFor(table, 'alice')).toBe(NOW + 61_000_000n);
    expect(table.rows.size).toBe(1);
  });
});

describe('resolveFastTravel: success', () => {
  it('same zone: lands on the waypoint, row zone stays 1', () => {
    const out = resolveFastTravel(travelInput());
    const wp = WAYPOINTS[Z1_WP_2];
    const dest = contentPosToPx(wp.zoneId, wp.pos);
    expect(out).toEqual({ ok: true, waypoint: wp, x: dest.x, y: dest.y });
    // What the reducer writes as zoneId (resolveZone, as travelToZone).
    expect(resolveZone(out.x, out.y)).toMatchObject({ zoneId: 1, inBounds: true });
    // And the landing spot counts as "at" the waypoint for the client's acceptance check.
    expect(playerWithinWaypointRange({ x: out.x, y: out.y }, wp)).toBe(true);
  });

  it('cross zone: zone-1 player at level 7 travels to a discovered zone-2 waypoint', () => {
    const out = resolveFastTravel(travelInput({ waypointId: Z2_WP, playerLevel: 7 }));
    const wp = WAYPOINTS[Z2_WP];
    const dest = contentPosToPx(2, wp.pos);
    expect(out).toEqual({ ok: true, waypoint: wp, x: dest.x, y: dest.y });
    expect(resolveZone(out.x, out.y)).toMatchObject({ zoneId: 2, inBounds: true });
  });

  it('cross zone back: zone-2 player travels home to zone 1', () => {
    const out = resolveFastTravel(travelInput({ player: playerAt(Z2_WP), waypointId: Z1_WP, playerLevel: 9 }));
    expect(out.ok).toBe(true);
    expect(resolveZone(out.x, out.y).zoneId).toBe(1);
  });

  it('accepts exactly at the 10 s attack lockout and the 60 s cooldown boundaries', () => {
    const out = resolveFastTravel(travelInput({
      player: playerAt(Z1_WP, { lastAttackAt: NOW - FAST_TRAVEL_COMBAT_LOCKOUT_MICROS }),
      lastFastTravelAt: NOW - FAST_TRAVEL_COOLDOWN_MICROS,
    }));
    expect(out.ok).toBe(true);
  });

  it('does not require being near the destination or in its zone (unlike discovery)', () => {
    const far = playerAt(Z1_WP, { x: 1600, y: 1600 });
    expect(resolveFastTravel(travelInput({ player: far })).ok).toBe(true);
  });
});

describe('resolveFastTravel: every rejection', () => {
  const stun = { effectKind: 'stun', magnitude: 0, expiresAt: NOW + 1_000_000n };
  const root = { effectKind: 'root', magnitude: 0, expiresAt: NOW + 1_000_000n };

  it.each([
    ['unknown waypoint', { waypointId: 'poi_nope' }, 'no-such-waypoint'],
    ['dead (hp 0)', { player: playerAt(Z1_WP, { hp: 0 }) }, 'dead'],
    ['dead (respawn pending)', { player: playerAt(Z1_WP, { deadUntil: NOW + 1n }) }, 'dead'],
    ['indoors (dungeon instance)', { player: playerAt(Z1_WP, { dungeonInstanceId: 3n }) }, 'indoors'],
    ['movement-restricted (stun)', { movementBlocked: movementRestriction([stun], NOW).blocked }, 'movement-restricted'],
    ['movement-restricted (root)', { movementBlocked: movementRestriction([root], NOW).blocked }, 'movement-restricted'],
    ['recent attack (1 s ago)', { player: playerAt(Z1_WP, { lastAttackAt: NOW - 1_000_000n }) }, 'recent-attack'],
    ['recent attack (1 us inside 10 s)', { player: playerAt(Z1_WP, { lastAttackAt: NOW - FAST_TRAVEL_COMBAT_LOCKOUT_MICROS + 1n }) }, 'recent-attack'],
    ['undiscovered', { discovered: false }, 'undiscovered'],
    ['level too low for zone 2 (level 6 < 7)', { waypointId: Z2_WP, playerLevel: 6 }, 'level-too-low'],
    ['cooldown (30 s after the last travel)', { lastFastTravelAt: NOW - 30_000_000n }, 'cooldown'],
    ['cooldown (1 us inside 60 s)', { lastFastTravelAt: NOW - FAST_TRAVEL_COOLDOWN_MICROS + 1n }, 'cooldown'],
  ])('rejects: %s', (_label, overrides, reason) => {
    expect(resolveFastTravel(travelInput(overrides))).toEqual({ ok: false, reason });
  });

  it('an expired stun does not restrict', () => {
    const expired = { effectKind: 'stun', magnitude: 0, expiresAt: NOW };
    expect(movementRestriction([expired], NOW).blocked).toBe(false);
    expect(resolveFastTravel(travelInput({ movementBlocked: false })).ok).toBe(true);
  });

  it('an ordinary slow does not restrict fast travel', () => {
    const slow = { effectKind: 'slow', magnitude: 50, expiresAt: NOW + 1_000_000n };
    expect(movementRestriction([slow], NOW).blocked).toBe(false);
  });
});

describe('index.ts wiring (the surface M12-7 regenerates bindings from)', () => {
  const src = readFileSync(new URL('../index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  it('declares discoverWaypoint(waypointId: string) and fastTravel(waypointId: string)', () => {
    expect(src).toContain('export const discoverWaypoint = spacetimedb.reducer(\n  { waypointId: t.string() },');
    expect(src).toContain('export const fastTravel = spacetimedb.reducer(\n  { waypointId: t.string() },');
  });

  it('declares the two new tables with the §2.5 shapes', () => {
    expect(src).toMatch(/playerWaypoint: table\(\n {4}\{ public: true \},\n {4}\{\n {6}id: +t\.u64\(\)\.primaryKey\(\)\.autoInc\(\),\n {6}owner: +t\.identity\(\)\.index\('btree'\),\n {6}waypointId: +t\.string\(\),[^\n]*\n {6}discoveredAt: +t\.u64\(\),/);
    expect(src).toMatch(/playerTravelState: table\(\n {4}\{ public: true \},\n {4}\{\n {6}identity: +t\.identity\(\)\.primaryKey\(\),\n {6}lastFastTravelAt: +t\.u64\(\),/);
  });

  it('fastTravel writes the row as travelToZone does', () => {
    const start = src.indexOf('export const fastTravel = spacetimedb.reducer(');
    const body = src.slice(start, src.indexOf('\n);\n', start));
    expect(body).toContain('movementRestriction(playerAuraRows(ctx, identity), now).blocked');
    expect(body).toContain('zoneId: resolveZone(outcome.x, outcome.y).zoneId,');
    expect(body).toContain('floorYM: 0,');
    expect(body).toContain('isMoving: false,');
    expect(body).toContain('lastMoveAt: now,');
    expect(body).toContain('stampFastTravel(ctx.db.playerTravelState, identity, now);');
    expect(body).toContain('discovered: hasDiscoveredWaypoint(ctx.db.playerWaypoint, identity, waypointId),');
    expect(body).toContain('playerLevel: getPlayerLevel(ctx, identity),');
    expect(body).toContain('lastFastTravelAt: lastFastTravelAtFor(ctx.db.playerTravelState, identity),');
  });

  it('discoverWaypoint resolves the guards and inserts once via the shared helpers', () => {
    const start = src.indexOf('export const discoverWaypoint = spacetimedb.reducer(');
    const body = src.slice(start, src.indexOf('\n);\n', start));
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('const outcome = resolveDiscoverWaypoint(player, waypointId, now);');
    expect(body).toContain('if (!outcome.ok) return;');
    expect(body).toContain('recordWaypointDiscovery(ctx.db.playerWaypoint, identity, waypointId, now);');
  });
});

describe('level-floor parity with gate travel (world/travel.ts)', () => {
  it('every real waypoint lands inside its own zone box', () => {
    for (const wp of ALL_WAYPOINTS) {
      const p = contentPosToPx(wp.zoneId, wp.pos);
      expect(resolveZone(p.x, p.y), wp.id).toEqual({ zoneId: wp.zoneId, inBounds: true, x: p.x, y: p.y });
    }
  });

  it('resolveGateTravel and resolveFastTravel agree on ok vs level-too-low for every gated zone, levels 0..20', () => {
    let compared = 0;
    for (const zone of Object.values(ZONES_BY_ID)) {
      for (const gate of zone.gates) {
        const dest = ZONES_BY_ID[gate.toZoneId];
        if (!dest) continue;
        const wp = ALL_WAYPOINTS.find((w) => w.zoneId === dest.id);
        if (!wp) continue;
        const gatePx = contentPosToPx(zone.id, gate.pos);
        for (let lvl = 0; lvl <= 20; lvl++) {
          const viaGate = resolveGateTravel(gatePx, zone.id, gate.id, lvl);
          const viaFast = resolveFastTravel(travelInput({ waypointId: wp.id, playerLevel: lvl }));
          expect(viaFast.ok ? 'ok' : viaFast.reason, `${gate.id} -> zone ${dest.id} @ level ${lvl}`)
            .toBe(viaGate.ok ? 'ok' : viaGate.reason);
          compared++;
        }
      }
    }
    // Zones 1 and 2 gate into each other today, so both directions are compared.
    expect(compared).toBeGreaterThanOrEqual(2 * 21);
  });
});
