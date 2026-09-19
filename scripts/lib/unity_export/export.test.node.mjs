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
import { exportTerrain, terrainPaths, hasTerrain } from './terrain.mjs';
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
  const realizedByZone = {};
  for (const zone of c.ZONES) {
    realizedByZone[zone.id] = exportWorldgen(repoRoot, zone).realized;
  }
  const files = await exportContent(c, realizedByZone, repoRoot);
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
  assert.deepEqual(parsed('zones.json').schemaVersion, 2);
  assert.deepEqual(parsed('zones.json').realized, realizedByZone);
  assert.deepEqual(Object.keys(parsed('zones.json').realized), c.ZONES.map((zone) => String(zone.id)));
  for (const zone of c.ZONES) {
    assert.deepEqual(Object.keys(parsed('zones.json').realized[zone.id]), SITE_KINDS);
  }
  assert.deepEqual(parsed('dungeons.json').dungeons, c.DUNGEONS);
  assert.deepEqual(parsed('zones.json').landmarks, c.ALL_LANDMARKS);
  // M11-6 (carried from M11-3's review): landmarks are the last content type
  // in zones.json to gain zoneId — npcs/spawns/waypoints already had it.
  assert.ok(parsed('zones.json').landmarks.length > 0);
  const zoneIds = new Set(c.ZONES.map((zone) => zone.id));
  for (const landmark of parsed('zones.json').landmarks) {
    assert.equal(typeof landmark.zoneId, 'number', `landmark ${landmark.id} missing numeric zoneId`);
    assert.ok(zoneIds.has(landmark.zoneId), `landmark ${landmark.id}: unknown zoneId ${landmark.zoneId}`);
  }

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

test('an unbaked zone is skipped rather than exported or crashed on (M9 precedent: zone3+ still has this shape)', () => {
  assert.equal(hasTerrain('nosuchzone'), false);
  assert.throws(() => exportTerrain({ surfaceY: () => 0 }, 'nosuchzone'), /not baked yet/);
  assert.throws(() => terrainPaths('nosuchzone'), /not baked yet/);
});

test('zone1 and zone2 both have terrain baked (M10-7a); the exporter emits both, invents nothing for zones without an entry', async () => {
  assert.equal(hasTerrain('zone1'), true);
  assert.equal(hasTerrain('zone2'), true);

  const c = await loadValidatedContent();
  assert.deepEqual(c.ZONES.map((zone) => zone.key), ['zone1', 'zone2']);
  const manifestPaths = Object.keys(JSON.parse(readFileSync(join(outputRoot, 'manifest.json'))).files);
  assert.ok(manifestPaths.some((path) => path.startsWith('terrain/zone1_')));
  assert.ok(manifestPaths.some((path) => path.startsWith('terrain/zone2_')));
  assert.ok(manifestPaths.includes('terrain/zone2_terrain.json'));
  assert.ok(manifestPaths.includes('terrain/zone2_splat.json'));
  assert.equal(manifestPaths.filter((path) => path.startsWith('terrain/zone2_tile_')).length, 16);
  assert.ok(manifestPaths.includes('worldgen/zone2_world.json'));

  const zones = JSON.parse(readFileSync(join(outputRoot, 'zones.json')));
  assert.equal(zones.schemaVersion, 2);
  assert.deepEqual(Object.keys(zones.realized), ['1', '2']);
  assert.deepEqual(Object.keys(zones.realized['2']), SITE_KINDS);
  // D176 (M11-2): zone2_world.json's scatter.chestCount went 0 -> 12, so Zone
  // 2 now realizes its own 12 chests, distinct from Zone 1's 25 — this test
  // pre-dates that and used to assert an empty list here (a stale
  // assumption this suite's own lack of a CI wiring let survive past M11-2
  // and M11-4; fixed as part of M11-6's own gate diligence).
  assert.equal(zones.realized['1'].chests.length, 25);
  assert.equal(zones.realized['2'].chests.length, 12);
  for (const chest of [...zones.realized['1'].chests, ...zones.realized['2'].chests]) {
    assert.equal(typeof chest.id, 'number');
    assert.equal(typeof chest.seed, 'number');
    assert.equal(typeof chest.x, 'number');
    assert.equal(typeof chest.z, 'number');
  }
  // D176's own widened collision check: no id may repeat across zones.
  const chestIds = [...zones.realized['1'].chests, ...zones.realized['2'].chests].map((c) => c.id);
  assert.equal(new Set(chestIds).size, chestIds.length, 'chest ids must be unique across zones');
});

test('zone2 terrain: grid shape, height range, tile edges and analytic/grid + splat sidecar all agree', () => {
  const sidecar = JSON.parse(readFileSync(join(outputRoot, 'terrain/zone2_terrain.json')));
  assert.equal(sidecar.tiles.length, 16);
  assert.equal(sidecar.samples.length, 1000);
  assert.equal(sidecar.tileSizeM, 256);
  assert.equal(sidecar.heightmapResolution, 257);
  assert.deepEqual(sidecar.originM, { x: -512, z: -512 });
  assert.deepEqual(sidecar.heightRange, { minMeters: -4, maxMeters: 64 });

  const tiles = new Map(sidecar.tiles.map((tile) =>
    [`${tile.ix},${tile.iz}`, readFileSync(join(outputRoot, 'terrain', tile.file))]));
  const at = (ix, iz, col, row) => tiles.get(`${ix},${iz}`).readUInt16LE((row * 257 + col) * 2);
  const { wg } = exportWorldgen(repoRoot, { id: 2, key: 'zone2', worldConfig: 'zone2_world.json' });
  let quantizationError = 0;
  for (const tile of sidecar.tiles) {
    assert.equal(tiles.get(`${tile.ix},${tile.iz}`).length, 257 * 257 * 2);
    assert.deepEqual(tile.originM, { x: -512 + tile.ix * 256, z: -512 + tile.iz * 256 });
    for (let row = 0; row <= 256; row++) {
      for (let col = 0; col <= 256; col++) {
        const analytic = wg.surfaceY(tile.originM.x + col, tile.originM.z + row);
        const grid = -4 + at(tile.ix, tile.iz, col, row) / 65535 * 68;
        assert.ok(analytic >= -4 && analytic <= 64, `zone2 height in range at (${tile.originM.x + col},${tile.originM.z + row})`);
        quantizationError = Math.max(quantizationError, Math.abs(analytic - grid));
      }
      if (tile.ix < 3) assert.equal(at(tile.ix, tile.iz, 256, row), at(tile.ix + 1, tile.iz, 0, row));
      if (tile.iz < 3) assert.equal(at(tile.ix, tile.iz, row, 256), at(tile.ix, tile.iz + 1, row, 0));
    }
  }
  assert.ok(quantizationError <= 68 / 65535 / 2 + 1e-12);

  const sidecarRng = mulberry32(0x5EED2000);
  let maxError = 0;
  for (const sample of sidecar.samples) {
    const { x, z } = sample;
    assert.equal(x, -512 + sidecarRng() * 1024);
    assert.equal(z, -512 + sidecarRng() * 1024);
    assert.equal(wg.surfaceY(x, z), sample.analytic);
    maxError = Math.max(maxError, Math.abs(sample.analytic - sample.grid));
  }
  assert.ok(maxError <= 8);
  console.log(`Zone2 max quantization error ${quantizationError} m; max sidecar analytic/grid error ${maxError} m.`);

  const splat = JSON.parse(readFileSync(join(outputRoot, 'terrain/zone2_splat.json')));
  assert.equal(splat.samples.length, 1000);
  assert.equal(splat.samplePointRule, 'Halton indices 1..1000; x = -512 + 1024 * H2(i); z = -512 + 1024 * H3(i).');
  for (const sample of splat.samples) {
    assert.ok(sample.x >= -512 && sample.x <= 512 && sample.z >= -512 && sample.z <= 512);
    assert.equal(sample.weights.length, 8);
    assert.ok(Math.abs(sample.weights.reduce((sum, w) => sum + w, 0) - 1) < 1e-9);
  }
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
      // Every zone's world config is a verbatim authored document, not reserialized JSON.
      if (!path.startsWith('worldgen/')) {
        assert.equal(bytes.toString(), JSON.stringify(JSON.parse(bytes), null, 2) + '\n', path);
      }
    }
  }
  assert.deepEqual(readFileSync(join(outputRoot, 'dungeons/castle_ashwood.json')),
    readFileSync(join(repoRoot, 'public/assets/castle/castle_ashwood.json')));
  assert.deepEqual(readFileSync(join(outputRoot, 'dungeons/barrowdeep.json')),
    readFileSync(join(repoRoot, 'public/assets/barrowdeep/barrowdeep.json')));
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
  const { wg } = exportWorldgen(repoRoot, { id: 1, key: 'zone1', worldConfig: 'zone1_world.json' });
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
