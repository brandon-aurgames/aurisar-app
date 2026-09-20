/**
 * Gate-based zone-to-zone travel (D155), the M10-11 reducer.
 *
 * Split the same way M10-1's own tests are (zoneBounds.test.js vs.
 * zoneOriginOffset.test.js): this file exercises `resolveGateTravel` against
 * the REAL, live content manifest, plus a source-text check that the
 * `travelToZone` reducer in index.ts actually wires that helper in with the
 * right guards. The multi-zone success/wrong-zone cases that don't depend on
 * whatever real content happens to ship live in travelToZoneMultiZone.test.js
 * instead, via the same manifest-mocking technique zoneOriginOffset.test.js
 * uses.
 *
 * UPDATED (M10-2, PR #364 merging M10-1+M10-11+real Zone 2 content together):
 * this file was originally written when zone 2 did not exist on `main` yet,
 * and used that fact to test the destination-exists guard against real
 * content (a well-formed claim through z1_north_pass came back
 * 'bad-destination' because zone 2 was not in the manifest at all). Now that
 * zone 2 is real (`levelBand: [7, 14]`, this same PR), that specific claim
 * clears the destination-exists guard and is refused one guard later instead
 * — 'level-too-low' — for a level-1 caller. The two cases below were updated
 * to match; they still prove the same thing about guard ORDER (range, then
 * destination-exists, then level), just against a different downstream
 * reason now that there is a real destination to have a level floor at all.
 *
 * `resolveGateTravel` is pure (no `ctx`, no `spacetimedb/server` import), so
 * it is imported and called directly, same as `resolveZone`/`contentPosToPx`.
 * The reducer itself is NOT imported or executed here: index.ts imports
 * `spacetimedb/server` at module scope, and the workspace intentionally runs
 * two different versions of that package (root vs. the exact `2.2.0` pin
 * under spacetimedb/) — see mobInsertColumns.test.js's own comment. Its
 * wiring is instead checked as source text, same as zoneBounds.test.js's own
 * "the server module actually uses it" section.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveGateTravel, ZONE_GATE_RANGE_PX } from '../../../../spacetimedb/src/world/travel.ts';
import { contentPosToPx } from '../../../../spacetimedb/src/world/zones.ts';
import { ZONES } from '../content/index.ts';

const repoRoot = join(import.meta.dirname, '../../../..');

const ZONE_1 = ZONES.find((z) => z.id === 1);
const NORTH_PASS = ZONE_1.gates.find((g) => g.id === 'z1_north_pass');
const gatePx = contentPosToPx(ZONE_1.id, NORTH_PASS.pos);

describe('ZONE_GATE_RANGE_PX', () => {
  it('is a sane, documented meter tolerance', () => {
    // 6 m, matching DUNGEON_GATE_RANGE_PX's own tolerance (dungeon/helpers.ts)
    // — not shared by import, just the same considered value.
    expect(ZONE_GATE_RANGE_PX).toBe(6 * 32);
  });
});

describe('resolveGateTravel against the real, live manifest (zone 1 only)', () => {
  it('the content z1_north_pass gate is still shaped the way D155 describes', () => {
    // Doc-as-code: if this stub's target ever changes, the cases below need
    // re-reading, not a silent pass.
    expect(NORTH_PASS).toBeDefined();
    expect(NORTH_PASS.toZoneId).toBe(2);
    expect(NORTH_PASS.toGateId).toBe('z2_south_pass');
  });

  it('zone 2 is real now (M10-2): a well-formed claim clears the destination-exists guard and is refused for level instead', () => {
    // Was 'bad-destination' when zone 2 did not exist; now that it does
    // (levelBand: [7, 14]), a level-1 caller clears every earlier guard and
    // is refused by the level floor instead. Proves the destination-exists
    // guard is satisfied, not skipped, now that there is a real zone 2 to
    // find z2_south_pass in.
    const outcome = resolveGateTravel(gatePx, ZONE_1.id, 'z1_north_pass', 1);
    expect(outcome).toEqual({ ok: false, reason: 'level-too-low' });
  });

  it('rejects a nonexistent gate id', () => {
    const outcome = resolveGateTravel(gatePx, ZONE_1.id, 'not_a_real_gate', 99);
    expect(outcome).toEqual({ ok: false, reason: 'no-such-gate' });
  });

  it('rejects a currentZoneId with no manifest entry at all', () => {
    // Stands in for "wrong zone" against real content: only one real zone
    // exists today, so there is no second real gate list to draw a foreign
    // gate id from — travelToZoneMultiZone.test.js covers that shape instead.
    const outcome = resolveGateTravel(gatePx, 999, 'z1_north_pass', 99);
    expect(outcome).toEqual({ ok: false, reason: 'no-such-gate' });
  });

  it('rejects a claim outside ZONE_GATE_RANGE_PX', () => {
    const farAway = { x: gatePx.x + ZONE_GATE_RANGE_PX + 1, y: gatePx.y };
    const outcome = resolveGateTravel(farAway, ZONE_1.id, 'z1_north_pass', 1);
    expect(outcome).toEqual({ ok: false, reason: 'out-of-range' });
  });

  it('accepts a claim exactly on the range boundary (inclusive, like playerNearChest/playerNearNpc)', () => {
    const onBoundary = { x: gatePx.x + ZONE_GATE_RANGE_PX, y: gatePx.y };
    const outcome = resolveGateTravel(onBoundary, ZONE_1.id, 'z1_north_pass', 1);
    // In range, and now (M10-2) refused downstream for the same level-too-low
    // reason as the direct-hit case above — proves range is checked BEFORE
    // the destination-exists/level guards, per the reducer's documented order.
    expect(outcome).toEqual({ ok: false, reason: 'level-too-low' });
  });

  it('rejects just past the range boundary', () => {
    const justPast = { x: gatePx.x + ZONE_GATE_RANGE_PX + 0.01, y: gatePx.y };
    const outcome = resolveGateTravel(justPast, ZONE_1.id, 'z1_north_pass', 1);
    expect(outcome).toEqual({ ok: false, reason: 'out-of-range' });
  });
});

describe('the travelToZone reducer actually wires resolveGateTravel in', () => {
  const server = readFileSync(join(repoRoot, 'spacetimedb/src/index.ts'), 'utf8');

  /** Source text from `anchor` through (not including) the next top-level `export const`. */
  const blockAfter = (anchor) => {
    const at = server.indexOf(anchor);
    expect(at, `anchor not found: ${anchor}`).toBeGreaterThan(-1);
    const next = server.indexOf('\nexport const ', at + anchor.length);
    return next === -1 ? server.slice(at) : server.slice(at, next);
  };

  it('takes only a gate id — no client-supplied coordinates to spoof (contrast buildCampfire)', () => {
    const body = blockAfter('export const travelToZone = spacetimedb.reducer(');
    expect(body).toContain('{ gateId: t.string() }');
  });

  it('checks the player exists, then dead/stunned/rooted, before anything else', () => {
    const body = blockAfter('export const travelToZone = spacetimedb.reducer(');
    const playerIdx = body.indexOf('ctx.db.player.identity.find(identity)');
    const deadIdx = body.indexOf('player.hp <= 0 || player.deadUntil > now');
    const restrictionIdx = body.indexOf('movementRestriction(playerAuraRows(ctx, identity), now)');
    expect(playerIdx).toBeGreaterThan(-1);
    expect(deadIdx).toBeGreaterThan(playerIdx);
    expect(restrictionIdx).toBeGreaterThan(deadIdx);
  });

  it('delegates content/proximity/level resolution to resolveGateTravel', () => {
    const body = blockAfter('export const travelToZone = spacetimedb.reducer(');
    expect(body).toContain('resolveGateTravel(player, player.zoneId, gateId, getPlayerLevel(ctx, identity))');
    expect(body).toContain('if (!outcome.ok) return;');
  });

  it('on success, re-derives zoneId via resolveZone rather than trusting content directly (D156/D157 idiom)', () => {
    const body = blockAfter('export const travelToZone = spacetimedb.reducer(');
    expect(body).toContain('zoneId: resolveZone(outcome.x, outcome.y).zoneId');
  });

  it('keeps floorYM and lastMoveAt in sync, same as enterDungeon/leaveDungeon', () => {
    const body = blockAfter('export const travelToZone = spacetimedb.reducer(');
    expect(body).toContain('floorYM: 0');
    expect(body).toContain('lastMoveAt: now');
  });
});
