// Explicit Node test entry point; .test.node.mjs keeps this out of Vitest's glob.
// Run: node --test scripts/lib/unity_export/export.test.node.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import './splat.test.node.mjs';
import './castle.test.node.mjs';
import { mulberry32 } from '../../../src/features/world/worldgen/rng.js';
import { loadValidatedContent } from './loader.mjs';
import { exportContent } from './content.mjs';
import { exportWorldgen, SITE_KINDS } from './worldgen.mjs';
import { exportTerrain, terrainPaths } from './terrain.mjs';
import { addManifest, jsonBytes, normalizeText, retainTerrain, sha256, writeOrCheck } from './manifest.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const outputRoot = join(repoRoot, 'export/unity-content');
const cli = join(repoRoot, 'scripts/export_unity_content.mjs');
const snapshot = () => new Map(readdirSync(outputRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => {
    const path = join(entry.parentPath, entry.name);
    return [path, readFileSync(path)];
  }).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));

function withFixture(run) {
  const scratchRoot = tmpdir();
  const path = mkdtempSync(join(scratchRoot, '.export-test-'));
  try {
    return run(path);
  } finally {
    // Only remove this test's verified, owned scratch directory.
    assert.ok(resolve(path).startsWith(resolve(scratchRoot) + sep + '.export-test-'));
    rmSync(path, { recursive: true, force: true });
  }
}

test('native TS loader validates content and exports ordered, lossless data', async () => {
  const c = await loadValidatedContent();
  const { realized } = exportWorldgen(repoRoot);
  const files = await exportContent(c, realized, repoRoot);
  const parsed = (path) => JSON.parse(files.get(path));
  assert.deepEqual(parsed('classes.json').classes, c.CLASS_IDS.map((id) => c.CLASS_KITS[id]));
  assert.deepEqual(parsed('classes.json').abilities.map((ability) => ability.id),
    c.CLASS_IDS.flatMap((id) => c.CLASS_KITS[id].abilityIds));
  assert.deepEqual(parsed('items.json').items, c.ALL_ITEMS);
  assert.deepEqual(parsed('quests.json').quests, c.ALL_QUESTS);
  for (const quest of parsed('quests.json').quests) {
    if (quest.reward.itemIdsByClass) {
      assert.deepEqual(Object.keys(quest.reward.itemIdsByClass),
        c.CLASS_IDS.filter((id) => quest.reward.itemIdsByClass[id] !== undefined));
    }
  }
  assert.deepEqual(parsed('zones.json').realized, realized);
  assert.deepEqual(Object.keys(parsed('zones.json').realized), SITE_KINDS);
  assert.deepEqual(parsed('dungeons.json').dungeons, c.DUNGEONS);

  // Mutate the in-memory source graph only; no canonical files are edited.
  const originalZone = c.ALL_NPCS[0].zoneId;
  try {
    c.ALL_NPCS[0].zoneId = -1;
    await assert.rejects(loadValidatedContent(), /Content validation failed/);
  } finally {
    c.ALL_NPCS[0].zoneId = originalZone;
  }
});

test('JSON boundary rejects non-finite numbers, null, and non-data; omits undefined fields', () => {
  for (const bad of [NaN, Infinity, -Infinity, null, () => 1, 1n, Symbol('bad')]) {
    assert.throws(() => jsonBytes({ tables: [{ nested: bad }] }), /Non-serializable/);
  }
  assert.throws(() => jsonBytes({ list: [undefined] }), /Non-serializable/);
  assert.equal(jsonBytes({ schemaVersion: 1, optional: undefined }).toString(), '{\n  "schemaVersion": 1\n}\n');
});

test('check is read-only, normalizes text only, detects missing/stale/orphan files; write prunes', (t) => withFixture((root) => {
  const logs = [];
  t.mock.method(console, 'log', (...args) => logs.push(args.join(' ')));
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  const files = new Map([
    ['data.json', jsonBytes({ schemaVersion: 1 })],
    ['tile.r16', Buffer.from([13, 10, 13, 10])],
  ]);
  addManifest(files);
  assert.equal(writeOrCheck(root, files, true), false);
  assert.ok(logs.some((line) => line === 'STALE: export/unity-content/data.json'));
  assert.equal(readdirSync(root).length, 0);
  assert.equal(writeOrCheck(root, files, false), true);
  const crlf = files.get('data.json').toString().replace(/\n/g, '\r\n');
  writeFileSync(join(root, 'data.json'), crlf);
  assert.equal(writeOrCheck(root, files, true), true);
  assert.equal(readFileSync(join(root, 'data.json'), 'utf8'), crlf);
  writeFileSync(join(root, 'tile.r16'), Buffer.from([10, 10]));
  writeFileSync(join(root, 'orphan.txt'), 'orphan\n');
  assert.equal(writeOrCheck(root, files, true), false);
  assert.ok(logs.some((line) => line === 'STALE: export/unity-content/tile.r16'));
  assert.ok(logs.some((line) => line === 'ORPHAN: export/unity-content/orphan.txt'));
  assert.equal(readFileSync(join(root, 'orphan.txt'), 'utf8'), 'orphan\n');
  assert.equal(writeOrCheck(root, files, false), true);
  assert.equal(writeOrCheck(root, files, true), true);
  assert.deepEqual(readdirSync(root).sort(), [...files.keys()].sort());
  assert.equal(readFileSync(join(root, 'data.json')).includes(13), false);
}));

test('no-terrain requires a complete, hash-verified pack and never blesses corruption', (t) => withFixture((root) => {
  t.mock.method(console, 'log', () => {});
  assert.throws(() => retainTerrain(root, terrainPaths()), /requires an existing full export/);
  const files = new Map(terrainPaths().map((path) => [path, readFileSync(join(outputRoot, path))]));
  addManifest(files);
  writeOrCheck(root, files, false);
  assert.equal(retainTerrain(root, terrainPaths()).size, 17);
  writeFileSync(join(root, 'terrain/zone1_tile_0_0.r16'), Buffer.from([0, 0]));
  assert.throws(() => retainTerrain(root, terrainPaths()), /STALE: export\/unity-content\/terrain\/zone1_tile_0_0.r16/);
}));

test('terrain rejects non-finite/out-of-range heights and excessive sampled interpolation error', () => {
  for (const height of [NaN, Infinity, -8.01, 136.01]) {
    assert.throws(() => exportTerrain({ surfaceY: () => height }), /Terrain height outside/);
  }
  assert.throws(() => exportTerrain({ surfaceY: (x) => Number.isInteger(x) ? 0 : 10 }),
    /Terrain analytic\/grid error exceeds/);
});

test('committed pack hashes, raw castle copy, tile edges, all grid samples, and sidecar agree', () => {
  const manifest = JSON.parse(readFileSync(join(outputRoot, 'manifest.json')));
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(Object.keys(manifest.files), Object.keys(manifest.files).sort());
  assert.equal(manifest.files['manifest.json'], undefined);
  assert.equal(snapshot().size, Object.keys(manifest.files).length + 1);
  for (const [path, hash] of Object.entries(manifest.files)) {
    const bytes = readFileSync(join(outputRoot, path));
    assert.equal(sha256(bytes), hash, path);
    if (!path.endsWith('.r16') && !path.endsWith('.bin')) {
      assert.deepEqual(bytes, normalizeText(bytes), path);
      // The world config is a verbatim authored document, not reserialized JSON.
      if (path !== 'worldgen/zone1_world.json') {
        assert.equal(bytes.toString(), JSON.stringify(JSON.parse(bytes), null, 2) + '\n', path);
      }
    }
  }
  assert.deepEqual(readFileSync(join(outputRoot, 'dungeons/castle_ashwood.json')),
    readFileSync(join(repoRoot, 'public/assets/castle/castle_ashwood.json')));
  const sidecar = JSON.parse(readFileSync(join(outputRoot, 'terrain/zone1_terrain.json')));
  assert.equal(sidecar.tiles.length, 16);
  assert.equal(sidecar.samples.length, 1000);
  assert.equal(sidecar.tileSizeM, 512);
  assert.equal(sidecar.heightmapResolution, 513);
  assert.deepEqual(sidecar.originM, { x: -1024, z: -1024 });
  assert.deepEqual(sidecar.heightRange, { minMeters: -8, maxMeters: 136 });
  const tiles = new Map(sidecar.tiles.map((tile) =>
    [`${tile.ix},${tile.iz}`, readFileSync(join(outputRoot, 'terrain', tile.file))]));
  const at = (ix, iz, col, row) => tiles.get(`${ix},${iz}`).readUInt16LE((row * 513 + col) * 2);
  const { wg } = exportWorldgen(repoRoot);
  let min = Infinity, max = -Infinity, quantizationError = 0;
  for (const tile of sidecar.tiles) {
    assert.equal(tiles.get(`${tile.ix},${tile.iz}`).length, 526338);
    assert.deepEqual(tile.originM, { x: -1024 + tile.ix * 512, z: -1024 + tile.iz * 512 });
    for (let row = 0; row <= 512; row++) {
      for (let col = 0; col <= 512; col++) {
        const analytic = wg.surfaceY(tile.originM.x + col, tile.originM.z + row);
        const grid = -8 + at(tile.ix, tile.iz, col, row) / 65535 * 144;
        min = Math.min(min, analytic);
        max = Math.max(max, analytic);
        quantizationError = Math.max(quantizationError, Math.abs(analytic - grid));
      }
      if (tile.ix < 3) assert.equal(at(tile.ix, tile.iz, 512, row), at(tile.ix + 1, tile.iz, 0, row));
      if (tile.iz < 3) assert.equal(at(tile.ix, tile.iz, row, 512), at(tile.ix, tile.iz + 1, row, 0));
    }
  }
  assert.ok(quantizationError <= 144 / 65535 / 2 + 1e-12);
  // Independently address the global integer grid across tile seams.
  const gridAt = (x, z) => {
    const gx = x + 1024, gz = z + 1024;
    const ix = Math.min(3, Math.floor(gx / 512)), iz = Math.min(3, Math.floor(gz / 512));
    return -8 + at(ix, iz, gx - ix * 512, gz - iz * 512) / 65535 * 144;
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const sidecarRng = mulberry32(0x5EED1000);
  let maxError = 0;
  for (const sample of sidecar.samples) {
    const { x, z } = sample;
    assert.equal(x, -1024 + sidecarRng() * 2048);
    assert.equal(z, -1024 + sidecarRng() * 2048);
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const low = lerp(gridAt(x0, z0), gridAt(x0 + 1, z0), x - x0);
    const high = lerp(gridAt(x0, z0 + 1), gridAt(x0 + 1, z0 + 1), x - x0);
    assert.ok(Math.abs(lerp(low, high, z - z0) - sample.grid) < 1e-10);
    assert.equal(wg.surfaceY(x, z), sample.analytic);
    maxError = Math.max(maxError, Math.abs(sample.analytic - sample.grid));
  }
  assert.ok(maxError <= 8);
  console.log(`Height range [${min}, ${max}] m; max quantization error ${quantizationError} m; max sidecar error ${maxError} m.`);
});

test('two additional full CLI writes are byte-identical; terrain flags and checks pass', () => {
  const before = snapshot();
  for (let run = 1; run <= 2; run++) {
    execFileSync(process.execPath, [cli], { cwd: repoRoot, stdio: 'pipe' });
    assert.deepEqual(snapshot(), before, `full write ${run}`);
  }
  for (const args of [['--terrain'], ['--no-terrain'], ['--check', '--terrain'], ['--check', '--no-terrain'], ['--check']]) {
    execFileSync(process.execPath, [cli, ...args], { cwd: repoRoot, stdio: 'pipe' });
    assert.deepEqual(snapshot(), before, args.join(' '));
  }
  assert.throws(() => execFileSync(process.execPath, [cli, '--terrain', '--no-terrain'], { stdio: 'pipe' }),
    (error) => error.status === 1 && error.stderr.toString().includes('Usage:'));
  assert.throws(() => execFileSync(process.execPath, [cli, '--unknown'], { stdio: 'pipe' }),
    (error) => error.status === 1 && error.stderr.toString().includes('Usage:'));
  console.log(`Two repeated writes and all valid flag combinations preserve ${before.size} files byte-for-byte.`);
});
