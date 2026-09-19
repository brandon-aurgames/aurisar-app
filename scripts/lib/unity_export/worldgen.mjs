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
  // spacetimedb/src/manifests/world_chests.json is emitted per-zone (D176,
  // scripts/emit_world_chests.mjs) over every zone whose own scatter.chestCount
  // > 0. Zone 1's chests carry no zoneId (WorldChestDef defaults a missing
  // zoneId to 1); every other zone's carry their zone id explicitly. Comparing
  // the WHOLE file against a single zone's realized list (the old zone1-only
  // check) stopped being correct the instant a second zone started
  // contributing chests, so this filters the server manifest down to THIS
  // zone's own slice — preserving zone-1's original ordered-comparand rigor —
  // and runs for any zone that actually contributes chests, not just zone 1.
  if (config.scatter?.chestCount > 0) {
    const server = JSON.parse(readFileSync(join(repoRoot, 'spacetimedb/src/manifests/world_chests.json'), 'utf8'));
    const ownChests = server.chests.filter((c) => (c.zoneId ?? 1) === zone.id);
    // Assert the complete ordered comparand as well as ids: positions/seeds cannot drift silently.
    if (server.version !== 1 || ownChests.length !== chests.length || chests.some((chest, index) =>
      ['id', 'x', 'z', 'seed'].some((key) => chest[key] !== ownChests[index][key]))) {
      throw new Error(`World chest mismatch (zone "${zone.key}"): regenerate spacetimedb/src/manifests/world_chests.json with emit:world-chests.`);
    }
  }
  // Author the category order, retain every site's original fields and array order.
  const realized = Object.fromEntries(SITE_KINDS.map((kind) => [kind, wg.sites[kind]]));
  if (Object.entries(wg.sites).some(([kind]) => !SITE_KINDS.includes(kind))) {
    throw new Error('New worldgen site category requires an explicit Unity export order.');
  }
  return { wg, realized };
}
