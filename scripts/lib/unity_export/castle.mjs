import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTERIOR_ANCHOR, LEVELS, LOCAL_BOUNDS, NAV_CELL, PLAYER_R } from '../../../src/features/world/castle/castlePlan.js';
import { buildNav } from '../../../src/features/world/castle/castleNav.js';
import { collectNavBlockers, stampNavBlockers } from '../../../src/features/world/castle/castleNavBlockers.js';
import { jsonBytes } from './manifest.mjs';

export const CASTLE_NAV_PATH = 'dungeons/castle_ashwood_nav.bin';
export const CASTLE_BLOCKERS_PATH = 'dungeons/castle_ashwood_blockers.json';
const serverPath = 'spacetimedb/src/castle/navGrids.ts';

/** Rebuild from the same sources and stamping order as emit-castle-manifest. */
export function exportCastle() {
  const nav = buildNav(INTERIOR_ANCHOR);
  const collected = collectNavBlockers(nav.anchor);
  stampNavBlockers(nav, collected);
  const bytes = Buffer.alloc(nav.grids.length * nav.cols * nav.rows * 2);
  let offset = 0;
  // Explicit LE writes also work on big-endian hosts. No header or padding:
  // byte offset = 2 * (level * rows * cols + row * cols + col).
  for (const grid of nav.grids) {
    for (const value of grid) {
      bytes.writeUInt16LE(value, offset);
      offset += 2;
    }
  }
  const blockers = collected.map(({ level, x0, z0, x1, z1, expand = PLAYER_R }) =>
    ({ level, x0, z0, x1, z1, expand }))
    .sort((a, b) => a.level - b.level || a.x0 - b.x0 || a.z0 - b.z0 || a.z1 - b.z1 || a.x1 - b.x1);
  return new Map([
    [CASTLE_NAV_PATH, bytes],
    [CASTLE_BLOCKERS_PATH, jsonBytes({
      cols: nav.cols, rows: nav.rows, levels: nav.grids.length,
      cell: NAV_CELL, bounds: LOCAL_BOUNDS, blockers,
    })],
  ]);
}

/** Read/decode the generated server comparand afresh; never use it as input. */
export function assertCastleNavParity(bytes, repoRoot) {
  const source = readFileSync(join(repoRoot, serverPath), 'utf8');
  const array = source.match(/export const CASTLE_NAV_BITMAPS_B64: readonly string\[\] = \[([\s\S]*?)\];/);
  if (!array) throw new Error(`Cannot find CASTLE_NAV_BITMAPS_B64 in ${serverPath}`);
  const lines = array[1].trim().split(/\r?\n/);
  const levels = lines.map((line, level) => {
    const match = line.match(/^\s*'([A-Za-z0-9+/]+={0,2})', \/\/ level (\d+)\s*$/);
    if (!match || Number(match[2]) !== level) throw new Error(`Invalid nav bitmap level ${level} in ${serverPath}`);
    const decoded = Buffer.from(match[1], 'base64');
    if (decoded.toString('base64') !== match[1]) throw new Error(`Invalid nav base64 in ${serverPath}`);
    return decoded;
  });
  const expectedLevels = LEVELS.length;
  if (levels.length !== expectedLevels || levels.some((level) => level.length !== bytes.length / expectedLevels) ||
      !Buffer.concat(levels).equals(bytes)) {
    throw new Error(`Castle nav anti-drift mismatch: ${CASTLE_NAV_PATH} differs from ${serverPath}. ` +
      'Run pnpm run emit:castle and pnpm run export:unity, then commit both generated outputs.');
  }
}
