// Included by export.test.node.mjs; also runnable with node --test on this file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CASTLE_NAV_BITMAPS_B64 } from '../../../spacetimedb/src/castle/navGrids.ts';
import { collectNavBlockers } from '../../../src/features/world/castle/castleNavBlockers.js';
import { exportCastle, assertCastleNavParity, CASTLE_NAV_PATH, CASTLE_BLOCKERS_PATH } from './castle.mjs';
import { sha256, writeOrCheck } from './manifest.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const outputRoot = join(repoRoot, 'export/unity-content');

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), '.unity-castle-test-'));
  try { return run(root); } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + '.unity-castle-test-'));
    rmSync(root, { recursive: true, force: true });
  }
}

test('castle nav is 1,617,000 LE bytes, level-major, with the architect populations and server parity', () => {
  const files = exportCastle();
  const bytes = files.get(CASTLE_NAV_PATH);
  assert.equal(bytes.length, 1617000);
  // Independent native TS import/decode checks the comparand parser as well.
  assert.deepEqual(bytes, Buffer.concat(CASTLE_NAV_BITMAPS_B64.map((b64) => Buffer.from(b64, 'base64'))));
  assertCastleNavParity(bytes, repoRoot);
  const populations = Array.from({ length: 5 }, (_, level) => {
    const counts = { blocked: 0, flat: 0, stair: 0 };
    for (let cell = 0; cell < 462 * 350; cell++) {
      const code = bytes.readUInt16LE(2 * (level * 462 * 350 + cell));
      if (code === 0) counts.blocked++;
      else if (code === 1) counts.flat++;
      else {
        assert.equal(code, level + 2);
        counts.stair++;
      }
    }
    return counts;
  });
  console.log('Measured castle populations (blocked/flat/stair):', JSON.stringify(populations));
  assert.deepEqual(populations, [
    { blocked: 90558, flat: 69182, stair: 1960 },
    { blocked: 64747, flat: 92098, stair: 4855 },
    { blocked: 52334, flat: 104511, stair: 4855 },
    { blocked: 87873, flat: 68972, stair: 4855 },
    { blocked: 51239, flat: 110461, stair: 0 },
  ]);
  assert.deepEqual(exportCastle(), files, 'repeated generation is deterministic');
  const manifest = JSON.parse(readFileSync(join(outputRoot, 'manifest.json')));
  for (const [path, expected] of files) {
    assert.deepEqual(readFileSync(join(outputRoot, path)), expected);
    assert.equal(manifest.files[path], sha256(expected));
  }
});

test('blocker header, raw rects, explicit expansion and full sort order match the contract', () => {
  const bytes = exportCastle().get(CASTLE_BLOCKERS_PATH);
  assert.equal(bytes.includes(13), false);
  assert.equal(bytes.at(-1), 10);
  const { blockers, ...header } = JSON.parse(bytes);
  assert.deepEqual(header, {
    cols: 462, rows: 350, levels: 5, cell: 0.25,
    bounds: { x0: -57.75, z0: -43.75, x1: 57.75, z1: 43.75 },
  });
  assert.equal(blockers.length, 377);
  assert.equal(blockers.filter((b) => b.expand === 0.35).length, 317);
  assert.equal(blockers.filter((b) => b.expand === 0).length, 60);
  assert.deepEqual(Array.from({ length: 5 }, (_, level) => blockers.filter((b) => b.level === level).length),
    [125, 99, 64, 39, 50]);
  const keys = ['level', 'x0', 'z0', 'x1', 'z1', 'expand'];
  const tuple = (b) => [b.level, b.x0, b.z0, b.z1, b.x1];
  for (let i = 0; i < blockers.length; i++) {
    assert.deepEqual(Object.keys(blockers[i]), keys);
    if (!i) continue;
    const previous = tuple(blockers[i - 1]), current = tuple(blockers[i]);
    const difference = current.findIndex((value, k) => value !== previous[k]);
    assert.ok(difference === -1 || current[difference] > previous[difference], `sort at ${i}`);
  }
  const canonical = (b) => JSON.stringify(keys.map((key) => key === 'expand' ? (b[key] ?? 0.35) : b[key]));
  assert.deepEqual(blockers.map(canonical).sort(), collectNavBlockers().map(canonical).sort());
});

test('binary check preserves CRLF and invalid UTF-8 bytes without text normalization', (t) => withFixture((root) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const files = new Map([[CASTLE_NAV_PATH, Buffer.from([13, 10, 255, 0, 128, 10])]]);
  assert.equal(writeOrCheck(root, files, false), true);
  assert.equal(writeOrCheck(root, files, true), true);
  writeFileSync(join(root, CASTLE_NAV_PATH), Buffer.from([10, 255, 0, 128, 10]));
  assert.equal(writeOrCheck(root, files, true), false);
}));

test('full CLI check rejects stale nav, stale blockers and changed server comparand read-only', () => withFixture((root) => {
  for (const path of [
    'scripts/export_unity_content.mjs', 'scripts/lib/unity_export',
    'src/features/world/content', 'src/features/world/config', 'src/features/world/worldgen',
    'src/features/world/castle', 'spacetimedb/src/castle/navGrids.ts',
    'spacetimedb/src/manifests/world_chests.json', 'public/assets/castle/castle_ashwood.json',
    'export/unity-content',
  ]) cpSync(join(repoRoot, path), join(root, path), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  const check = () => spawnSync(process.execPath, ['scripts/export_unity_content.mjs', '--check'], {
    cwd: root, encoding: 'utf8',
  });
  for (const path of [CASTLE_NAV_PATH, CASTLE_BLOCKERS_PATH]) {
    const target = join(root, 'export/unity-content', path);
    const original = readFileSync(target);
    const stale = Buffer.from(original);
    stale[0] ^= 1;
    writeFileSync(target, stale);
    const result = check();
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stderr.includes(`STALE: export/unity-content/${path}`), result.stderr);
    assert.deepEqual(readFileSync(target), stale);
    writeFileSync(target, original);
  }
  const server = join(root, 'spacetimedb/src/castle/navGrids.ts');
  const changed = readFileSync(server, 'utf8').replace(
    /(CASTLE_NAV_BITMAPS_B64[^=]*=\s*\[\s*')([A-Za-z0-9+/])/, (_, prefix, first) => prefix + (first === 'A' ? 'B' : 'A'));
  writeFileSync(server, changed);
  const result = check();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr);
  assert.ok(result.stderr.includes('Castle nav anti-drift mismatch'), result.stderr);
  assert.equal(readFileSync(server, 'utf8'), changed);
  for (const path of [CASTLE_NAV_PATH, CASTLE_BLOCKERS_PATH]) {
    assert.deepEqual(readFileSync(join(root, 'export/unity-content', path)), readFileSync(join(outputRoot, path)));
  }
}));
