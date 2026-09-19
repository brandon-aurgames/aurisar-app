/**
 * emit-world-chests.mjs — bake deterministic world chest positions/seeds.
 *
 * D176: per-zone. Runs over EVERY zone in content/zones/manifest.ts ZONES
 * whose own scatter.chestCount > 0 (today: Zone 1's 25, Zone 2's 12) — not
 * Zone 1 alone. A zone with chestCount 0 (or a future zone with none authored
 * yet) contributes nothing, automatically, with no code change needed here
 * when that changes.
 *
 * Source: createWorldgen(<zone>.worldConfig) per contributing zone.
 * Outputs:
 *   spacetimedb/src/manifests/world_chests.json
 *   src/features/world/content/world/chestManifest.generated.ts
 *
 *   node scripts/emit_world_chests.mjs
 *   node scripts/emit_world_chests.mjs --check
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContentModule } from './lib/unity_export/loader.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CHECK = process.argv.includes('--check');

const { ZONES } = await loadContentModule('zones/manifest.ts');
const { createWorldgen } = await import('../src/features/world/worldgen/index.js');

// Ids are position-derived (worldgen/sites.js chestKey), NOT array indices.
// The old `id: index` meant any manifest edit that re-indexed the array —
// an added exclusion zone, a scatter tweak — silently remapped every player's
// persisted playerChestOpened history onto different chests. See
// worldgen/DETERMINISM.md § "Index-keyed data".
//
// zoneId is omitted for Zone 1 chests (spacetimedb/src/world/chest.ts's
// WorldChestDef defaults a missing zoneId to 1), so every already-committed
// Zone-1 entry stays byte-identical to before per-zone chests existed. Every
// other zone's chests carry their zone id explicitly — there is no implicit
// zone for them to fall back to.
const chests = [];
for (const zone of ZONES) {
  const config = JSON.parse(
    readFileSync(join(repoRoot, 'src/features/world/config', zone.worldConfig), 'utf8'),
  );
  if (!(config.scatter?.chestCount > 0)) continue;
  const wg = createWorldgen(config);
  for (const c of wg.sites.chests) {
    chests.push(
      zone.id === 1
        ? { id: c.id, x: c.x, z: c.z, seed: c.seed }
        : { id: c.id, x: c.x, z: c.z, seed: c.seed, zoneId: zone.id },
    );
  }
}

// FATAL: chest id collision — widened from within-zone to ACROSS ALL ZONES
// (D176). chestKey(x, z, seed) (worldgen/sites.js) hashes zone-LOCAL x/z, so
// nothing structurally stops two zones' chests from colliding; today's
// separation (each zone's own worldgen seed) is incidental, not structural,
// which is exactly why this check now spans the combined, cross-zone list
// instead of validating each zone's contribution in isolation.
const ids = new Set(chests.map((c) => c.id));
if (ids.size !== chests.length) {
  console.error(`FATAL: chest id collision (${chests.length} chests, ${ids.size} distinct ids, across all zones).`);
  process.exit(1);
}
if (chests.some((c) => !Number.isInteger(c.id) || c.id < 0 || c.id > 0xffffffff)) {
  console.error('FATAL: chest id outside u32 range (playerChestOpened.chestId is u32).');
  process.exit(1);
}

const json = JSON.stringify({ version: 1, chests }, null, 2) + '\n';

const JSON_PATH = join(repoRoot, 'spacetimedb/src/manifests/world_chests.json');
const TS_PATH = join(repoRoot, 'src/features/world/content/world/chestManifest.generated.ts');

const tsBody =
  '// GENERATED FILE — DO NOT EDIT.\n' +
  '// Source: scripts/emit_world_chests.mjs (every zone in content/zones/manifest.ts\n' +
  "//         ZONES whose own scatter.chestCount > 0 — see that zone's *_world.json)\n" +
  '// Regenerate with: node scripts/emit_world_chests.mjs\n\n' +
  'export interface WorldChestDef {\n' +
  '  id: number;\n' +
  '  x: number;\n' +
  '  z: number;\n' +
  '  seed: number;\n' +
  '  /** Content ZoneDef.id this chest is zone-local to. Omitted for Zone 1. */\n' +
  '  zoneId?: number;\n' +
  '}\n\n' +
  `export const WORLD_CHESTS: WorldChestDef[] = ${JSON.stringify(chests, null, 2)};\n`;

function checkFile(path, expected) {
  if (!existsSync(path)) return false;
  return readFileSync(path, 'utf8') === expected;
}

if (CHECK) {
  const jsonOk = checkFile(JSON_PATH, json);
  const tsOk = checkFile(TS_PATH, tsBody);
  if (!jsonOk || !tsOk) {
    console.error('STALE: world chest manifest is out of date. Run: node scripts/emit_world_chests.mjs');
    process.exit(1);
  }
  console.log(`OK: ${chests.length} world chests`);
  process.exit(0);
}

mkdirSync(dirname(JSON_PATH), { recursive: true });
mkdirSync(dirname(TS_PATH), { recursive: true });
writeFileSync(JSON_PATH, json);
writeFileSync(TS_PATH, tsBody);
console.log(`Wrote ${chests.length} chests → manifests/world_chests.json + content/world/chestManifest.generated.ts`);
