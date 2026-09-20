/**
 * emit-barrowdeep-manifest.mjs — export The Barrowdeep's layout + collision
 * metadata + server nav bitmaps (M11-5, D169–D172/D175).
 *
 * Source of truth: src/features/world/barrowdeep/barrowdeepPlan.js
 * Outputs:
 *   public/assets/barrowdeep/barrowdeep.json
 *   spacetimedb/src/manifests/barrowdeep.json
 *   spacetimedb/src/barrowdeep/navGrids.ts                     (server nav validation bitmaps)
 *   src/features/world/content/dungeons/barrowdeep.generated.ts (entry + spawn markers)
 *
 *   node scripts/emit-barrowdeep-manifest.mjs
 *   node scripts/emit-barrowdeep-manifest.mjs --check
 *
 * A deliberate sibling of emit-castle-manifest.mjs rather than a
 * parameterization of it: that script's `--check` byte-compares Castle
 * Ashwood's 2.1 MB of committed output, so folding a second dungeon into it
 * would make every Barrowdeep edit a diff against Ashwood's gate for no gain.
 * The two scripts are the same 80 lines twice; when a third dungeon lands,
 * merge them then — with two real call sites to generalize from.
 *
 * The Barrowdeep ships NO furniture/blocker pass (Castle Ashwood's
 * stampNavBlockers runs its Babylon builders under a fake-BABYLON shim). Its
 * interior geometry and props are Unity's, built from this manifest in
 * M11-11/M11-12; when those add real blockers, the parity harness M11-14
 * builds is what proves the server bitmaps still match the built scene.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BARROWDEEP_PLAN, LOCAL_BOUNDS, LEVELS, ROOMS, NAV_CELL, PLAYER_R, PLAYER_SKIN,
  WALL_T, STEP_UP, PLAN_SCALE, EXTERIOR, SHELL_COLLISION, INTERIOR_ANCHOR, STAIRS,
  ZONE_ID,
} from '../src/features/world/barrowdeep/barrowdeepPlan.js';
import { STEP_DOWN, buildNav } from '../src/features/world/barrowdeep/barrowdeepNav.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CHECK = process.argv.includes('--check');

const JSON_PATHS = [
  join(repoRoot, 'public', 'assets', 'barrowdeep', 'barrowdeep.json'),
  join(repoRoot, 'spacetimedb', 'src', 'manifests', 'barrowdeep.json'),
];
const NAV_GRIDS_TS = join(repoRoot, 'spacetimedb', 'src', 'barrowdeep', 'navGrids.ts');
const DUNGEON_SPAWNS_TS = join(repoRoot, 'src', 'features', 'world', 'content', 'dungeons', 'barrowdeep.generated.ts');

const nav = buildNav(INTERIOR_ANCHOR);
const navLevels = nav.grids.map((grid, level) => ({
  level,
  encoding: 'uint16-le-base64',
  data: Buffer.from(grid.buffer, grid.byteOffset, grid.byteLength).toString('base64'),
}));

const manifest = {
  meta: {
    id: 'barrowdeep',
    version: '1.0.0',
    source: 'src/features/world/barrowdeep/barrowdeepPlan.js',
    runtime: 'procedural',
  },
  layout: {
    name: BARROWDEEP_PLAN.name,
    planScale: PLAN_SCALE,
    // Zone-local to zone 2, NOT world metres — zone 2's originOffsetM is
    // {3000, 0}. Both are emitted so no consumer has to know that from memory.
    zoneId: ZONE_ID,
    interiorAnchor: INTERIOR_ANCHOR,
    bounds: LOCAL_BOUNDS,
    levels: LEVELS,
    rooms: BARROWDEEP_PLAN.rooms,
    doors: BARROWDEEP_PLAN.doors,
    stairs: BARROWDEEP_PLAN.stairs,
    voids: BARROWDEEP_PLAN.voids,
    entry: BARROWDEEP_PLAN.entry,
    materialSpec: BARROWDEEP_PLAN.materialSpec,
    spawnMarkers: BARROWDEEP_PLAN.spawnMarkers,
    exterior: BARROWDEEP_PLAN.exterior,
  },
  collision: {
    navCellM: NAV_CELL,
    playerRadiusM: PLAYER_R,
    playerSkinM: PLAYER_SKIN,
    wallThicknessM: WALL_T,
    stepUpM: STEP_UP,
    stepDownM: STEP_DOWN,
    interiorBounds: LOCAL_BOUNDS,
    shell: {
      site: EXTERIOR.site,
      halfW: EXTERIOR.halfW,
      halfD: EXTERIOR.halfD,
      moundH: EXTERIOR.moundH,
      marginM: SHELL_COLLISION.marginM,
      cameraSkinM: SHELL_COLLISION.cameraSkinM,
    },
    navGrid: {
      cols: nav.cols,
      rows: nav.rows,
      levels: LEVELS.length,
      encoding: 'uint16-le-base64',
      bitmapSource: 'spacetimedb/src/barrowdeep/navGrids.ts',
    },
  },
};

const payload = `${JSON.stringify(manifest, null, 2)}\n`;

const navGridsTs = `// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/barrowdeep/barrowdeepPlan.js + barrowdeepNav.js
// Regenerate with: node scripts/emit-barrowdeep-manifest.mjs

/**
 * The Barrowdeep's interior nav bitmaps, the twin of castle/navGrids.ts.
 *
 * \`anchor\` is ZONE-LOCAL to zone ${ZONE_ID}, not world metres — zone ${ZONE_ID}'s
 * originOffsetM is carried alongside it so a consumer cannot resolve this
 * against zone 1's origin the way D173 item 2 did. Convert with
 * world/zones.ts's contentPosToPx(zoneId, …), never with a bare \`m * 32 + 1600\`.
 *
 * READ BY THE SERVER'S INTERIOR NAV as of R21. dungeon/helpers.ts registers
 * these grids as the Barrowdeep's own DUNGEON_INTERIOR_ENTRY.nav descriptor,
 * and dungeon/interiorNav.ts resolves every interior step against whichever
 * dungeon's descriptor the instance actually names — player wall collision and
 * floor tracking in movePlayer, mob stepping and floor backfill in tickMobAI.
 * Castle Ashwood's grids are never consulted for a step taken in here, and
 * these are never consulted for a step taken there (D174 item 3).
 *
 * Before R21 nothing read this file at all: castle/surface.ts's scan closed
 * over CASTLE_NAV_META / CASTLE_LEVELS / CASTLE_STAIRS, so interior wall
 * collision inside the barrow was not enforced server-side and a player's
 * floorYM was zeroed on their first step inside.
 */
export const BARROWDEEP_NAV_META = {
  zoneId: ${ZONE_ID},
  anchor: ${JSON.stringify(INTERIOR_ANCHOR)},
  bounds: ${JSON.stringify(LOCAL_BOUNDS)},
  navCellM: ${NAV_CELL},
  cols: ${nav.cols},
  rows: ${nav.rows},
  levelCount: ${LEVELS.length},
} as const;

export const BARROWDEEP_NAV_BITMAPS_B64: readonly string[] = [
${navLevels.map((l) => `  '${l.data}', // level ${l.level}`).join('\n')}
];

export const BARROWDEEP_LEVELS = ${JSON.stringify(LEVELS, null, 2)} as const;

export const BARROWDEEP_STAIRS = ${JSON.stringify(STAIRS, null, 2)} as const;

export const BARROWDEEP_STEP_UP = ${STEP_UP};
export const BARROWDEEP_STEP_DOWN = ${STEP_DOWN};

/** roomId → walkable floor Y (metres) for dungeon mob spawn height. */
export const BARROWDEEP_ROOM_FLOOR_Y = ${JSON.stringify(
  Object.fromEntries(ROOMS.map((r) => [r.id, LEVELS[r.level].y])),
  null,
  2,
)} as const;
`;

const dungeonSpawnsTs = `// GENERATED FILE — DO NOT EDIT.
// Regenerate with: node scripts/emit-barrowdeep-manifest.mjs

/** The zone the Barrowdeep's entrance AND interior both live in. */
export const BARROWDEEP_ZONE_ID = ${ZONE_ID};

/**
 * Interior-local (0,0) expressed in ZONE ${ZONE_ID}'s local metres (D175).
 * Exported so dungeon/helpers.ts registers it from the plan instead of
 * re-typing the literal the way CASTLE_INTERIOR_ANCHOR does.
 */
export const BARROWDEEP_INTERIOR_ANCHOR = ${JSON.stringify(INTERIOR_ANCHOR, null, 2)} as const;

export const BARROWDEEP_ENTRY = ${JSON.stringify(BARROWDEEP_PLAN.entry, null, 2)} as const;

export const BARROWDEEP_SPAWNS = ${JSON.stringify(BARROWDEEP_PLAN.spawnMarkers, null, 2)} as const;
`;

function writeOrCheck(path, content, label) {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current === content) return false;
  if (CHECK) {
    console.error(`STALE: ${label}`);
    return true;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`  wrote  ${label}`);
  return false;
}

let stale = false;
for (const outPath of JSON_PATHS) {
  stale = writeOrCheck(outPath, payload, outPath.replace(repoRoot + '/', '')) || stale;
}
stale = writeOrCheck(NAV_GRIDS_TS, navGridsTs, NAV_GRIDS_TS.replace(repoRoot + '/', '')) || stale;
stale = writeOrCheck(DUNGEON_SPAWNS_TS, dungeonSpawnsTs, DUNGEON_SPAWNS_TS.replace(repoRoot + '/', '')) || stale;

if (CHECK && stale) {
  console.error('\nBarrowdeep manifest out of date — run `node scripts/emit-barrowdeep-manifest.mjs` and commit.');
  process.exit(1);
}
if (CHECK) console.log('Barrowdeep manifest up to date.');
