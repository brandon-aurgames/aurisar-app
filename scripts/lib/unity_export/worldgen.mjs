import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWorldgen } from '../../../src/features/world/worldgen/index.js';

export const SITE_KINDS = [
  'trees', 'rocks', 'bushes', 'details', 'ruins', 'caves', 'chests', 'ponds',
  'forestTrees', 'forestBrush', 'forestLogs',
];

/**
 * @param {{ key: string, worldConfig: string }} zone - a `ZONES` entry (zones/manifest.ts).
 */
export function exportWorldgen(repoRoot, zone) {
  const config = JSON.parse(readFileSync(join(repoRoot, 'src/features/world/config/', zone.worldConfig), 'utf8'));
  const wg = createWorldgen(config);
  const chests = wg.sites.chests;
  const ids = new Set(chests.map((chest) => chest.id));
  if (ids.size !== chests.length || chests.some((chest) =>
    !Number.isInteger(chest.id) || chest.id < 0 || chest.id > 0xffffffff)) {
    throw new Error(`World chest ids must be unique position-derived u32 values (zone "${zone.key}").`);
  }
  // spacetimedb/src/manifests/world_chests.json is emitted from zone1_world.json ONLY
  // (scripts/emit_world_chests.mjs; see zone2_world.json's own meta.notes) — the parity
  // check against it is meaningless for any other zone, whose chests it does not cover.
  if (zone.key === 'zone1') {
    const server = JSON.parse(readFileSync(join(repoRoot, 'spacetimedb/src/manifests/world_chests.json'), 'utf8'));
    // Assert the complete ordered comparand as well as ids: positions/seeds cannot drift silently.
    if (server.version !== 1 || server.chests.length !== chests.length || chests.some((chest, index) =>
      ['id', 'x', 'z', 'seed'].some((key) => chest[key] !== server.chests[index][key]))) {
      throw new Error('World chest mismatch: regenerate spacetimedb/src/manifests/world_chests.json with emit:world-chests.');
    }
  }
  // Author the category order, retain every site's original fields and array order.
  const realized = Object.fromEntries(SITE_KINDS.map((kind) => [kind, wg.sites[kind]]));
  if (Object.entries(wg.sites).some(([kind]) => !SITE_KINDS.includes(kind))) {
    throw new Error('New worldgen site category requires an explicit Unity export order.');
  }
  return { wg, realized };
}
