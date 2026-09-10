// Included by export.test.node.mjs; also runnable with node --test on this file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createBiomes } from '../../../src/features/world/worldgen/biomes.js';
import { createHeightfield } from '../../../src/features/world/worldgen/heightfield.js';
import { createTrails } from '../../../src/features/world/worldgen/trails.js';
import { createZones } from '../../../src/features/world/worldgen/zones.js';
import { computeUnitySplat, exportSplat } from './splat.mjs';
import { sha256 } from './manifest.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const outputRoot = join(repoRoot, 'export/unity-content');
const worldPath = 'worldgen/zone1_world.json';
const splatPath = 'terrain/zone1_splat.json';
const sourceBytes = readFileSync(join(repoRoot, 'src/features/world/config/zone1_world.json'));

test('world config export is byte-identical to source and both new files have manifest hashes', () => {
  assert.deepEqual(readFileSync(join(outputRoot, worldPath)), sourceBytes);
  const manifest = JSON.parse(readFileSync(join(outputRoot, 'manifest.json')));
  for (const path of [worldPath, splatPath]) {
    const bytes = readFileSync(join(outputRoot, path));
    assert.equal(bytes.includes(13), false, `${path}: LF only`);
    assert.equal(sha256(bytes), manifest.files[path], path);
  }
});

test('1000 deterministic splat rows use baked heights, CONFIG-SAFE web functions, and normalized weights', () => {
  const config = JSON.parse(sourceBytes);
  const zones = createZones(config);
  const unexpectedRng = () => assert.fail('Splat parity must not draw any RNG');
  const wg = {
    ...zones,
    ...createHeightfield(config, zones),
    ...createTrails(config),
    ...createBiomes(config, unexpectedRng),
    surfaceY: () => assert.fail('Splat altitude must come from the baked tiles'),
  };
  const terrain = JSON.parse(readFileSync(join(outputRoot, 'terrain/zone1_terrain.json')));
  const files = new Map(terrain.tiles.map((tile) =>
    [`terrain/${tile.file}`, readFileSync(join(outputRoot, 'terrain', tile.file))]));
  const bytes = readFileSync(join(outputRoot, splatPath));
  assert.deepEqual(exportSplat(wg, files), bytes);
  assert.deepEqual(exportSplat(wg, files), bytes, 'repeat evaluation is deterministic');
  const sidecar = JSON.parse(bytes);
  assert.equal(sidecar.formulaVersion, 1);
  assert.deepEqual(sidecar.layerOrder, [
    'Grass_Lush', 'Grass_Dry', 'Forest_Floor', 'Dirt_Trail',
    'Sand_Shore', 'Rock_Cliff', 'Rock_Scree', 'Snow',
  ]);
  assert.equal(sidecar.samples.length, 1000);
  assert.equal(new Set(sidecar.samples.map(({ x, z }) => `${x},${z}`)).size, 1000);
  assert.equal(sidecar.samples[0].x, 0);
  assert.equal(sidecar.samples[0].z, -1024 + 2048 / 3);
  assert.equal(sidecar.samples[1].x, -512);
  assert.equal(sidecar.samples[1].z, -1024 + 2048 * 2 / 3);
  // Independently reverse the base-N digits to pin the complete Halton rule.
  const radicalInverse = (i, base) => [...i.toString(base)].reverse()
    .reduce((sum, digit, place) => sum + Number(digit) / base ** (place + 1), 0);
  const gridAt = (x, z) => {
    const gx = x + 1024, gz = z + 1024;
    const ix = Math.min(3, Math.floor(gx / 512)), iz = Math.min(3, Math.floor(gz / 512));
    const tile = files.get(`terrain/zone1_tile_${ix}_${iz}.r16`);
    return -8 + tile.readUInt16LE(((gz - iz * 512) * 513 + gx - ix * 512) * 2) / 65535 * 144;
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const layerHits = Array(8).fill(0);
  for (const [index, sample] of sidecar.samples.entries()) {
    const { x, z, alt, weights } = sample;
    assert.deepEqual(Object.keys(sample), ['x', 'z', 'alt', 'weights']);
    assert.ok(Math.abs(x - (-1024 + 2048 * radicalInverse(index + 1, 2))) < 1e-10);
    assert.ok(Math.abs(z - (-1024 + 2048 * radicalInverse(index + 1, 3))) < 1e-10);
    assert.ok(x >= -1024 && x <= 1024 && z >= -1024 && z <= 1024);
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const low = lerp(gridAt(x0, z0), gridAt(x0 + 1, z0), x - x0);
    const high = lerp(gridAt(x0, z0 + 1), gridAt(x0 + 1, z0 + 1), x - x0);
    assert.ok(Math.abs(alt - lerp(low, high, z - z0)) < 1e-10);
    assert.equal(weights.length, 8);
    weights.forEach((weight, layer) => {
      assert.ok(Number.isFinite(weight) && weight >= 0 && weight <= 1);
      if (weight > 0) layerHits[layer]++;
    });
    assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) <= 1e-6);
    if (!wg.inForest(x, z)) assert.equal(weights[2], 0, 'forest floor is Wildwood only');
  }
  assert.ok(layerHits.every((hits) => hits > 0), `all eight layers sampled: ${layerHits}`);
});

test('layer formulas clamp scree subtraction and normalize overlapping forest, trail, shore, and snow', () => {
  const model = (green, trail = 0, sand = 0, cliff = 0, forest = false) => ({
    biomeColorAt: (x, z, out) => Object.assign(out, { r: 0, g: green, b: 0 }),
    trailDirtAt: () => trail,
    lakeShoreAt: () => sand,
    mtnCliffAt: () => cliff,
    inForest: () => forest,
    surfaceY: () => assert.fail('analytic altitude is forbidden'),
  });
  const close = (actual, expected) => actual.forEach((weight, index) =>
    assert.ok(Math.abs(weight - expected[index]) < 1e-12, `layer ${index}: ${weight}`));
  close(computeUnitySplat(model(0.16), 0, 0, 0), [0.5, 0.5, 0, 0, 0, 0, 0, 0]);
  close(computeUnitySplat(model(0), 0, 0, 0), [0.35, 0, 0, 0, 0, 0.65, 0, 0]);
  close(computeUnitySplat(model(0, 0, 0, 0.8), 0, 0, 60), [0, 0, 0, 0, 0, 0.8, 0.2, 0]);
  close(computeUnitySplat(model(0, 0, 0, 0.8), 0, 0, 112), [0, 0, 0, 0, 0, 0.4, 0.1, 0.5]);
  close(computeUnitySplat(model(0.2, 0.25, 0.2, 0, true), 0, 0, 0),
    [0, 0.56 / 1.62, 0.56 / 1.62, 0.3 / 1.62, 0.2 / 1.62, 0, 0, 0]);
  close(computeUnitySplat(model(0.2, 2, 2, 0, true), 0, 0, 0), [0, 0, 0, 0.5, 0.5, 0, 0, 0]);
});

test('full CLI check rejects either stale parity file without rewriting it', () => {
  const scratchRoot = tmpdir();
  const root = mkdtempSync(join(scratchRoot, '.unity-splat-test-'));
  try {
    // Isolated offline exporter fixture: no edits to the working pack or sources.
    for (const path of [
      'scripts/export_unity_content.mjs', 'scripts/lib/unity_export',
      'src/features/world/content', 'src/features/world/config', 'src/features/world/worldgen',
      'src/features/world/castle', 'spacetimedb/src/castle/navGrids.ts',
      'spacetimedb/src/manifests/world_chests.json', 'public/assets/castle/castle_ashwood.json',
      'export/unity-content',
    ]) cpSync(join(repoRoot, path), join(root, path), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    for (const path of [worldPath, splatPath]) {
      const target = join(root, 'export/unity-content', path);
      const original = readFileSync(target);
      const stale = Buffer.from('{}\n');
      writeFileSync(target, stale);
      const result = spawnSync(process.execPath, ['scripts/export_unity_content.mjs', '--check'], {
        cwd: root, encoding: 'utf8',
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1, result.stderr);
      assert.ok(result.stderr.includes(`STALE: export/unity-content/${path}`), result.stderr);
      assert.deepEqual(readFileSync(target), stale, '--check is read-only');
      writeFileSync(target, original);
    }
  } finally {
    assert.ok(resolve(root).startsWith(resolve(scratchRoot) + sep + '.unity-splat-test-'));
    rmSync(root, { recursive: true, force: true });
  }
});
