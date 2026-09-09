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
import { exportTerrain, terrainPaths } from './lib/unity_export/terrain.mjs';
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
  const { wg, realized } = exportWorldgen(repoRoot);
  const files = await exportContent(content, realized, repoRoot);
  console.log(`Realized: ${SITE_KINDS.map((kind) => `${kind}=${realized[kind].length}`).join(', ')}`);

  if (args.includes('--no-terrain')) {
    for (const [path, bytes] of retainTerrain(outputRoot, terrainPaths())) files.set(path, bytes);
    console.log('Terrain retained from verified export; analytic regeneration skipped.');
  } else {
    const terrain = exportTerrain(wg);
    for (const [path, bytes] of terrain.files) files.set(path, bytes);
    console.log(`Terrain: measured height [${terrain.minMeters}, ${terrain.maxMeters}] m; ` +
      `max |analytic - grid| = ${terrain.maxAnalyticGridErrorM} m (1000 samples, limit 8 m).`);
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
