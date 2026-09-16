/**
 * resolveGateTravel proved against a second zone (D155), the way the M10-1
 * origin-offset fix is proved in zoneOriginOffset.test.js: Zone 2's content
 * does not exist yet (M10-2), so this file stands a second zone up by mocking
 * the manifest rather than by adding content the rest of the repo would then
 * have to carry.
 *
 * The synthetic zone 2 only ADDS the reciprocal `z2_south_pass` gate; zone 1
 * is otherwise the real, live manifest entry, including its own real
 * `z1_north_pass` gate (`{ toZoneId: 2, toGateId: 'z2_south_pass' }`) — so
 * this is exactly the pairing D157's content-authoring back-link validation
 * already enforces, just supplied here instead of by real Zone 2 content.
 */
import { describe, expect, it, vi } from 'vitest';

const ZONE_2_LEVEL_BAND = [12, 24];

vi.mock('../../../../spacetimedb/src/content/zones/manifest.ts', async (importOriginal) => {
  const actual = await importOriginal();
  const zone1 = actual.ZONES.find((z) => z.id === 1);
  const zone2 = {
    ...zone1,
    id: 2,
    key: 'zone2',
    name: 'Test Zone Two',
    levelBand: ZONE_2_LEVEL_BAND,
    originOffsetM: { x: 3000, z: 0 },
    // The zone-1 side of this pairing is zone1's own real z1_north_pass gate
    // (manifest.ts); only the zone-2 side needs inventing here.
    gates: [
      { id: 'z2_south_pass', pos: { x: 0, z: -170 }, toZoneId: 1, toGateId: 'z1_north_pass' },
    ],
  };
  const zones = [zone1, zone2];
  return {
    ...actual,
    ZONES: zones,
    ZONES_BY_ID: Object.fromEntries(zones.map((z) => [z.id, z])),
    getZone: (id) => zones.find((z) => z.id === id) ?? null,
  };
});

const { resolveGateTravel } = await import('../../../../spacetimedb/src/world/travel.ts');
const { contentPosToPx } = await import('../../../../spacetimedb/src/world/zones.ts');

const zone1GatePx = contentPosToPx(1, { x: 0, z: 170 }); // z1_north_pass
const zone2GatePx = contentPosToPx(2, { x: 0, z: -170 }); // z2_south_pass

describe('a working zone 1 <-> zone 2 gate pair', () => {
  it('zone 1 -> zone 2 succeeds when in range and level clears the destination band floor', () => {
    const outcome = resolveGateTravel(zone1GatePx, 1, 'z1_north_pass', ZONE_2_LEVEL_BAND[0]);
    expect(outcome).toEqual({ ok: true, zoneId: 2, x: zone2GatePx.x, y: zone2GatePx.y });
  });

  it('zone 2 -> zone 1 succeeds via the reciprocal gate (round trip)', () => {
    const outcome = resolveGateTravel(zone2GatePx, 2, 'z2_south_pass', 1);
    expect(outcome).toEqual({ ok: true, zoneId: 1, x: zone1GatePx.x, y: zone1GatePx.y });
  });

  it('a higher level than the floor still travels in — only the floor is enforced, not a ceiling', () => {
    const outcome = resolveGateTravel(zone1GatePx, 1, 'z1_north_pass', 99);
    expect(outcome.ok).toBe(true);
  });
});

describe('the destination zone levelBand floor (D162), same shape as enterDungeon.minLevel', () => {
  it('rejects one level under the destination zone floor', () => {
    const outcome = resolveGateTravel(zone1GatePx, 1, 'z1_north_pass', ZONE_2_LEVEL_BAND[0] - 1);
    expect(outcome).toEqual({ ok: false, reason: 'level-too-low' });
  });

  it('accepts exactly at the floor (inclusive, matching dungeon.minLevel/quest.minLevel)', () => {
    const outcome = resolveGateTravel(zone1GatePx, 1, 'z1_north_pass', ZONE_2_LEVEL_BAND[0]);
    expect(outcome.ok).toBe(true);
  });

  it('a returning higher-level character is never blocked entering the lower zone 1 band', () => {
    const outcome = resolveGateTravel(zone2GatePx, 2, 'z2_south_pass', 50);
    expect(outcome.ok).toBe(true);
  });
});

describe('a gate id from the wrong zone is not found', () => {
  it('zone 2 does not recognise zone 1\'s gate id', () => {
    const outcome = resolveGateTravel(zone1GatePx, 2, 'z1_north_pass', 99);
    expect(outcome).toEqual({ ok: false, reason: 'no-such-gate' });
  });

  it('zone 1 does not recognise zone 2\'s gate id', () => {
    const outcome = resolveGateTravel(zone2GatePx, 1, 'z2_south_pass', 99);
    expect(outcome).toEqual({ ok: false, reason: 'no-such-gate' });
  });
});
