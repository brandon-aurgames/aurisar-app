/**
 * One-way canonical web content -> Unity JSON + raw height tiles (Node 22.18+).
 *   node scripts/export_unity_content.mjs              # full write; prune orphans
 *   node scripts/export_unity_content.mjs --check      # full in-memory regeneration
 *   node scripts/export_unity_content.mjs --terrain    # explicit full write
 *   node scripts/export_unity_content.mjs --no-terrain # preserve verified terrain; no bake
 * --no-terrain is the build shortcut, requires an existing full export, and does
 * not validate terrain against heightfield changes. CI must use the full --check.
 */
import { fileURLToPath } from 'node:url';
import { loadValidatedContent } from './lib/unity_export/loader.mjs';
import { exportContent } from './lib/unity_export/content.mjs';
import { exportWorldgen, SITE_KINDS } from './lib/unity_export/worldgen.mjs';
import { exportTerrain, terrainPaths, hasTerrain } from './lib/unity_export/terrain.mjs';
import { exportSplat } from './lib/unity_export/splat.mjs';
import { exportDungeon, assertDungeonNavParity } from './lib/unity_export/castle.mjs';
import { addManifest, retainTerrain, writeOrCheck } from './lib/unity_export/manifest.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--check', '--terrain', '--no-terrain'].includes(arg)) ||
      (args.includes('--terrain') && args.includes('--no-terrain'))) {
    throw new Error('Usage: node scripts/export_unity_content.mjs [--check] [--terrain | --no-terrain]');
  }
  const repoRoot = fileURLToPath(new URL('../', import.meta.url));
  const outputRoot = fileURLToPath(new URL('../export/unity-content/', import.meta.url));
  const content = await loadValidatedContent(); // Before worldgen, serialization, or any writes.
  // One worldgen instance + realized site set per zone the manifest actually defines
  // (today: zone1, zone2) — nothing here assumes there is exactly one zone.
  const zoneWorldgens = new Map();
  const realizedByZone = {};
  for (const zone of content.ZONES) {
    const { wg, realized } = exportWorldgen(repoRoot, zone);
    zoneWorldgens.set(zone.id, wg);
    realizedByZone[zone.id] = realized;
    console.log(`Realized (zone ${zone.id} "${zone.key}"): ` +
      `${SITE_KINDS.map((kind) => `${kind}=${realized[kind].length}`).join(', ')}`);
  }
  const files = await exportContent(content, realizedByZone, repoRoot);
  // One nav .bin + blockers .json per registered dungeon (M11-6); an
  // unregistered dungeon's layout already throws inside exportContent's own
  // DUNGEON_LAYOUT_DIRS lookup, so DUNGEONS here is never a partial list.
  for (const dungeon of content.DUNGEONS) {
    for (const [path, bytes] of exportDungeon(dungeon.id)) files.set(path, bytes);
  }
  if (args.includes('--check')) {
    for (const dungeon of content.DUNGEONS) assertDungeonNavParity(dungeon.id, files, repoRoot);
  }

  // Terrain (and the splat sidecar derived from it) exists only for zones that
  // have actually been baked (see terrain.mjs's ZONE_TERRAIN). Zone 2's bake is
  // M10-8, a later Unity-side task — until then it emits no terrain files at
  // all, which is the correct current state, not a bug to route around here.
  const bakedZones = content.ZONES.filter((zone) => hasTerrain(zone.key));
  const skippedZones = content.ZONES.filter((zone) => !hasTerrain(zone.key));
  for (const zone of skippedZones) {
    console.log(`Terrain: zone "${zone.key}" has no baked terrain yet — skipping.`);
  }

  if (args.includes('--no-terrain')) {
    const allTerrainPaths = bakedZones.flatMap((zone) => terrainPaths(zone.key));
    for (const [path, bytes] of retainTerrain(outputRoot, allTerrainPaths)) files.set(path, bytes);
    console.log('Terrain retained from verified export; analytic regeneration skipped.');
  } else {
    for (const zone of bakedZones) {
      const terrain = exportTerrain(zoneWorldgens.get(zone.id), zone.key);
      for (const [path, bytes] of terrain.files) files.set(path, bytes);
      console.log(`Terrain (zone "${zone.key}"): measured height [${terrain.minMeters}, ${terrain.maxMeters}] m; ` +
        `max |analytic - grid| = ${terrain.maxAnalyticGridErrorM} m (1000 samples, limit 8 m).`);
    }
  }
  // Re-evaluate visual config even with --no-terrain; heights use verified tiles.
  for (const zone of bakedZones) {
    files.set(`terrain/${zone.key}_splat.json`, exportSplat(zoneWorldgens.get(zone.id), files, zone.key));
  }
  addManifest(files);
  const check = args.includes('--check');
  if (!writeOrCheck(outputRoot, files, check)) {
    process.exitCode = 1;
    return;
  }
  console.log(`${check ? 'Up to date' : 'Exported'}: ${files.size} Unity content files.`);
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
