import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadContentModule } from './loader.mjs';
import { jsonBytes, normalizeText } from './manifest.mjs';

/** Only named data exports cross the boundary; combat functions stay in TS. */
async function formulas() {
  const [xp, combat, prices, loot, cooking] = await Promise.all([
    loadContentModule('formulas/xp.ts'),
    loadContentModule('formulas/combat.ts'),
    loadContentModule('formulas/prices.ts'),
    loadContentModule('formulas/chestLoot.ts'),
    loadContentModule('formulas/cooking.ts'),
  ]);
  const constants = {
    GAME_XP_ENABLED: xp.GAME_XP_ENABLED,
    MAX_LEVEL: xp.MAX_LEVEL,
    GCD_SEC: combat.GCD_SEC,
    GCD_SEC_ENERGY: combat.GCD_SEC_ENERGY,
    CRIT_MULT: combat.CRIT_MULT,
    ARMOR_DR_CAP: combat.ARMOR_DR_CAP,
    COPPER_PER_SILVER: prices.COPPER_PER_SILVER,
    COPPER_PER_GOLD: prices.COPPER_PER_GOLD,
    COPPER_PER_PLATINUM: prices.COPPER_PER_PLATINUM,
    SELL_RATIO: prices.SELL_RATIO,
  };
  const tables = {
    XP_TABLE: xp.XP_TABLE,
    PARTY_XP_MULT: xp.PARTY_XP_MULT,
    CHEST_LOOT: loot.CHEST_LOOT,
    RECIPES: cooking.RECIPES,
  };
  for (const [name, value] of [...Object.entries(constants), ...Object.entries(tables)]) {
    if (value === undefined) throw new Error(`Missing formula export: ${name}`);
  }
  return { schemaVersion: 1, constants, tables };
}

export async function exportContent(content, realized, repoRoot) {
  const c = content;
  const classes = c.CLASS_IDS.map((id) => c.CLASS_KITS[id]);
  const abilitiesById = new Map(c.ALL_ABILITIES.map((ability) => [ability.id, ability]));
  const abilities = classes.flatMap((kit) => kit.abilityIds.map((id) => abilitiesById.get(id)));
  assert.equal(abilities.length, c.ALL_ABILITIES.length,
    'Exported ability count must equal ALL_ABILITIES.length');
  assert.equal(new Set(abilities.map((ability) => ability.id)).size, abilities.length,
    'Exported ability ids must be unique');
  const quests = c.ALL_QUESTS.map((quest) => ({
    ...quest,
    reward: {
      copper: quest.reward.copper,
      itemIdsByClass: quest.reward.itemIdsByClass === undefined ? undefined : Object.fromEntries(
        c.CLASS_IDS.filter((id) => quest.reward.itemIdsByClass[id] !== undefined)
          .map((id) => [id, quest.reward.itemIdsByClass[id]]),
      ),
      itemIds: quest.reward.itemIds,
      templateUnlockIds: quest.reward.templateUnlockIds,
      gameXp: quest.reward.gameXp,
    },
  }));
  // Arrays and their records retain source-authored field/order semantics.
  const files = new Map([
    ['classes.json', jsonBytes({ schemaVersion: 1, classes, abilities })],
    ['items.json', jsonBytes({ schemaVersion: 1, items: c.ALL_ITEMS })],
    ['quests.json', jsonBytes({ schemaVersion: 1, quests })],
    ['zones.json', jsonBytes({
      schemaVersion: 1,
      zones: c.ZONES,
      npcs: c.ALL_NPCS,
      mobs: c.ALL_MOBS,
      spawns: c.SPAWNS,
      waypoints: c.ALL_WAYPOINTS,
      landmarks: c.ALL_LANDMARKS,
      realized,
    })],
    ['dungeons.json', jsonBytes({ schemaVersion: 1, dungeons: c.DUNGEONS })],
    ['formulas.json', jsonBytes(await formulas())],
  ]);
  // D50: preserve authored JSON formatting; only normalize Windows line endings.
  files.set('worldgen/zone1_world.json', normalizeText(
    readFileSync(join(repoRoot, 'src/features/world/config/zone1_world.json')),
  ));
  for (const dungeon of c.DUNGEONS) {
    // M1 has one layout source. Fail on new layouts rather than guess their location.
    if (dungeon.layoutManifest !== 'castle_ashwood.json') {
      throw new Error(`Unregistered dungeon layout: ${dungeon.layoutManifest}`);
    }
    // D22: no parse/reserialize, extra wrapper, schemaVersion, or second nav serializer.
    const bytes = normalizeText(readFileSync(join(repoRoot, 'public/assets/castle', dungeon.layoutManifest)));
    files.set(`dungeons/${dungeon.layoutManifest}`, bytes);
  }
  return files;
}
