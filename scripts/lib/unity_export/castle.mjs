import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INTERIOR_ANCHOR as CASTLE_INTERIOR_ANCHOR,
  LEVELS as CASTLE_LEVELS,
  LOCAL_BOUNDS as CASTLE_LOCAL_BOUNDS,
  NAV_CELL as CASTLE_NAV_CELL,
  PLAYER_R as CASTLE_PLAYER_R,
} from '../../../src/features/world/castle/castlePlan.js';
import { buildNav as buildCastleNav } from '../../../src/features/world/castle/castleNav.js';
import { collectNavBlockers, stampNavBlockers } from '../../../src/features/world/castle/castleNavBlockers.js';
import {
  INTERIOR_ANCHOR as BARROWDEEP_INTERIOR_ANCHOR,
  LEVELS as BARROWDEEP_LEVELS,
  LOCAL_BOUNDS as BARROWDEEP_LOCAL_BOUNDS,
  NAV_CELL as BARROWDEEP_NAV_CELL,
  PLAYER_R as BARROWDEEP_PLAYER_R,
} from '../../../src/features/world/barrowdeep/barrowdeepPlan.js';
import { buildNav as buildBarrowdeepNav } from '../../../src/features/world/barrowdeep/barrowdeepNav.js';
import { jsonBytes } from './manifest.mjs';

/**
 * M11-6: dungeon-parameterized (was Castle-Ashwood-only). Kept at this
 * filename per TASKS.md's own "castle.mjs (→ dungeon-parameterized)" wording
 * — the same "descriptor table in, constants out, existing output
 * byte-identical" transform D174 already applied elsewhere (M10-4/M10-5's
 * ZoneGrid/TerrainGrid, and R21's planned spacetimedb/src/castle/surface.ts).
 * Parameterizing in place (rather than a barrowdeep.mjs sibling, the shape
 * M11-5 chose for emit-*-manifest.mjs) is the right call HERE specifically
 * because this file, unlike those emitters, holds no dungeon-specific
 * authoring data of its own — it only re-derives bytes fresh from each
 * dungeon's plan/nav modules on every run and diffs them against that
 * dungeon's own committed server file. There is no multi-megabyte gate
 * living inside this file for a second dungeon's edits to collide with.
 *
 * Adding a dungeon means adding one entry to DUNGEON_NAV_SOURCES below; an
 * unregistered dungeonId still throws rather than guessing, the same shape
 * as content.mjs's own DUNGEON_LAYOUT_DIRS.
 */
const DUNGEON_NAV_SOURCES = {
  castle_ashwood: {
    serverPath: 'spacetimedb/src/castle/navGrids.ts',
    bitmapConst: 'CASTLE_NAV_BITMAPS_B64',
    emitCommand: 'pnpm run emit:castle',
    interiorAnchor: CASTLE_INTERIOR_ANCHOR,
    localBounds: CASTLE_LOCAL_BOUNDS,
    navCell: CASTLE_NAV_CELL,
    playerR: CASTLE_PLAYER_R,
    levelCount: CASTLE_LEVELS.length,
    buildNav: buildCastleNav,
    // Castle Ashwood's committed bitmap is buildNav()'s grid with furniture/
    // structure blockers stamped on top (matches emit-castle-manifest.mjs's
    // own build+stamp order exactly); blockers.json reports that same set.
    collectBlockers(nav) {
      const collected = collectNavBlockers(nav.anchor);
      stampNavBlockers(nav, collected);
      return collected;
    },
  },
  barrowdeep: {
    serverPath: 'spacetimedb/src/barrowdeep/navGrids.ts',
    bitmapConst: 'BARROWDEEP_NAV_BITMAPS_B64',
    emitCommand: 'pnpm run emit:barrowdeep',
    interiorAnchor: BARROWDEEP_INTERIOR_ANCHOR,
    localBounds: BARROWDEEP_LOCAL_BOUNDS,
    navCell: BARROWDEEP_NAV_CELL,
    playerR: BARROWDEEP_PLAYER_R,
    levelCount: BARROWDEEP_LEVELS.length,
    buildNav: buildBarrowdeepNav,
    // The Barrowdeep ships NO furniture/blocker pass — emit-barrowdeep-manifest.mjs's
    // own comment: "Castle Ashwood's stampNavBlockers runs its Babylon builders
    // under a fake-BABYLON shim", which barrowdeepNav's buildNav() result has
    // no equivalent hook for (no blockRect method). Its committed bitmap is
    // buildNav()'s raw output, unstamped, so it reports zero blockers.
    collectBlockers: () => [],
  },
};

function dungeonSource(dungeonId) {
  const source = DUNGEON_NAV_SOURCES[dungeonId];
  if (!source) throw new Error(`Unregistered dungeon nav source: ${dungeonId}`);
  return source;
}

/** Path helpers: same `dungeons/{id}_{suffix}` shape for every dungeon. */
export const dungeonNavPath = (dungeonId) => `dungeons/${dungeonId}_nav.bin`;
export const dungeonBlockersPath = (dungeonId) => `dungeons/${dungeonId}_blockers.json`;

/** Rebuild one dungeon's nav .bin + blockers .json from the same sources and
 * stamping order as its emit-*-manifest.mjs script. */
export function exportDungeon(dungeonId) {
  const source = dungeonSource(dungeonId);
  const nav = source.buildNav(source.interiorAnchor);
  const collected = source.collectBlockers(nav);
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
  const blockers = collected.map(({ level, x0, z0, x1, z1, expand = source.playerR }) =>
    ({ level, x0, z0, x1, z1, expand }))
    .sort((a, b) => a.level - b.level || a.x0 - b.x0 || a.z0 - b.z0 || a.z1 - b.z1 || a.x1 - b.x1);
  return new Map([
    [dungeonNavPath(dungeonId), bytes],
    [dungeonBlockersPath(dungeonId), jsonBytes({
      cols: nav.cols, rows: nav.rows, levels: nav.grids.length,
      cell: source.navCell, bounds: source.localBounds, blockers,
    })],
  ]);
}

/** Read/decode the generated server comparand afresh; never use it as input.
 * `files` is the export map (or any Map keyed like it) holding this
 * dungeon's own exportDungeon() output — never a second serialization. */
export function assertDungeonNavParity(dungeonId, files, repoRoot) {
  const source = dungeonSource(dungeonId);
  const bytes = files.get(dungeonNavPath(dungeonId));
  if (!bytes) throw new Error(`No exported nav bytes for dungeon ${dungeonId} (${dungeonNavPath(dungeonId)})`);
  const text = readFileSync(join(repoRoot, source.serverPath), 'utf8');
  const pattern = new RegExp(`export const ${source.bitmapConst}: readonly string\\[\\] = \\[([\\s\\S]*?)\\];`);
  const array = text.match(pattern);
  if (!array) throw new Error(`Cannot find ${source.bitmapConst} in ${source.serverPath}`);
  const lines = array[1].trim().split(/\r?\n/);
  const levels = lines.map((line, level) => {
    const match = line.match(/^\s*'([A-Za-z0-9+/]+={0,2})', \/\/ level (\d+)\s*$/);
    if (!match || Number(match[2]) !== level) throw new Error(`Invalid nav bitmap level ${level} in ${source.serverPath}`);
    const decoded = Buffer.from(match[1], 'base64');
    if (decoded.toString('base64') !== match[1]) throw new Error(`Invalid nav base64 in ${source.serverPath}`);
    return decoded;
  });
  const expectedLevels = source.levelCount;
  if (levels.length !== expectedLevels || levels.some((level) => level.length !== bytes.length / expectedLevels) ||
      !Buffer.concat(levels).equals(bytes)) {
    throw new Error(`Dungeon nav anti-drift mismatch: ${dungeonNavPath(dungeonId)} differs from ${source.serverPath}. ` +
      `Run ${source.emitCommand} and pnpm run export:unity, then commit both generated outputs.`);
  }
}
