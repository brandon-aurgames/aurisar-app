/**
 * World chests, per-zone (M11-2, D176).
 *
 * `scripts/emit_world_chests.mjs` used to read `zone1_world.json` only —
 * `zone2_world.json`'s own meta.notes recorded that its 12 authored chests
 * (M11-4) were "not server-openable yet" until the emitter became per-zone.
 * This file proves the live, committed manifests actually closed that gap:
 * both zones' chests are present, distinguishable by zone, and — the point
 * D176 exists for — collision-free ACROSS zones, not just within one.
 *
 * `chestKey(x, z, seed)` (worldgen/sites.js) hashes zone-LOCAL x/z, so
 * nothing structurally stops two zones' chests from sharing an id; only the
 * emitter's own widened FATAL check (and this regression test) stand between
 * a future zone's worldgen edit and a silent cross-zone id collision.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORLD_CHESTS } from '../content/world/chestManifest.generated';
import { chestKey } from '../worldgen/sites.js';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');
const zone2Config = JSON.parse(
  readFileSync(join(repoRoot, 'src/features/world/config/zone2_world.json'), 'utf8'),
);

const zone1Chests = WORLD_CHESTS.filter((c) => c.zoneId === undefined);
const zone2Chests = WORLD_CHESTS.filter((c) => c.zoneId === 2);

describe('both zones are really in the one committed manifest', () => {
  it('37 total: Zone 1\'s 25 (untagged) + Zone 2\'s 12 (zoneId 2)', () => {
    expect(WORLD_CHESTS.length).toBe(37);
    expect(zone1Chests.length).toBe(25);
    expect(zone2Chests.length).toBe(zone2Config.scatter.chestCount);
    expect(zone2Chests.length).toBe(12);
    // Every chest is accounted for by exactly one of the two filters above —
    // there is no third bucket (e.g. a typo'd zoneId) hiding in the manifest.
    expect(zone1Chests.length + zone2Chests.length).toBe(WORLD_CHESTS.length);
  });

  it('no other zoneId value appears (guards against a future zone 3 landing untagged)', () => {
    for (const c of WORLD_CHESTS) {
      expect(c.zoneId === undefined || c.zoneId === 2).toBe(true);
    }
  });
});

describe('cross-zone id collisions (D176\'s own reasoning, checked rather than trusted)', () => {
  it('all 37 ids are globally distinct, not just distinct within each zone', () => {
    const ids = new Set(WORLD_CHESTS.map((c) => c.id));
    expect(ids.size).toBe(WORLD_CHESTS.length);
  });

  it('no Zone-2 chest id collides with any Zone-1 chest id', () => {
    const zone1Ids = new Set(zone1Chests.map((c) => c.id));
    for (const c of zone2Chests) {
      expect(zone1Ids.has(c.id)).toBe(false);
    }
  });
});

describe('Zone 2 chests are genuine worldgen output, not placeholders', () => {
  it('every Zone-2 chest id is position-derived (chestKey(x, z, seed)), same contract as Zone 1', () => {
    for (const c of zone2Chests) {
      expect(c.id).toBe(chestKey(c.x, c.z, c.seed));
    }
  });

  it('every Zone-2 chest sits inside Zone 2\'s own playable disc (its own radius, not Zone 1\'s)', () => {
    for (const c of zone2Chests) {
      expect(Math.hypot(c.x, c.z)).toBeLessThanOrEqual(zone2Config.radius);
    }
  });

  it('positions are real (non-integer, worldgen-scattered) — not stub/round-number data', () => {
    // A placeholder fixture would tend to use round numbers; real scatter
    // output does not. Weak on purpose (one exception wouldn't be a bug) —
    // it only needs to catch "someone hand-typed 12 fake rows".
    const looksHandAuthored = zone2Chests.every((c) => Number.isInteger(c.x) && Number.isInteger(c.z));
    expect(looksHandAuthored).toBe(false);
  });
});

describe('the server manifest (spacetimedb/src/manifests/world_chests.json) matches, zone for zone', () => {
  const server = JSON.parse(
    readFileSync(join(repoRoot, 'spacetimedb/src/manifests/world_chests.json'), 'utf8'),
  );

  it('is the identical 37-chest list the web content mirrors (both emitted together)', () => {
    expect(server.chests).toEqual(WORLD_CHESTS);
  });
});
