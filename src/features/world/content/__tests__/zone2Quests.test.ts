import { describe, expect, it } from 'vitest';
import { ALL_QUESTS, DUNGEONS, ITEMS, MOBS, NPCS, WAYPOINTS, validateContent } from '../index';
import { QUESTS } from '../zones/zone2/quests';
import { MOBS as ZONE2_MOBS, SPAWNS } from '../zones/zone2/mobs';
import { QUESTS as ZONE1_QUESTS } from '../zones/zone1/quests';
import { ZONE2_ITEMS } from '../items/zone2';
import { GAME_XP_ENABLED } from '../formulas/xp';

const ids = [
  'q_z2_up_from_the_pass', 'q_z2_trampled_fences', 'q_z2_stalker_pelts',
  'q_z2_what_the_cairns_let_out', 'q_z2_lay_the_wights',
  'q_z2_the_barrow_revenant', 'q_z2_under_the_scarp', 'q_z2_into_the_barrowdeep',
];

describe('Zone 2 quest chain (D206-D208)', () => {
  it('adds exactly eight quests on one linear spine, retaining all sixteen Zone 1 quests', () => {
    expect(QUESTS.map(q => q.id)).toEqual(ids);
    expect(ALL_QUESTS).toEqual([...ZONE1_QUESTS, ...QUESTS]);
    expect(ALL_QUESTS).toHaveLength(24);
    QUESTS.forEach((q, i) => {
      expect(q.zoneId).toBe(2);
      expect(q.requiresQuestId).toBe(i === 0 ? undefined : ids[i - 1]);
    });
  });

  it('pins the objectives, counts, named spawns and fitness level gates', () => {
    expect(QUESTS.map(q => q.minLevel)).toEqual([undefined, 7, 8, 9, 10, 11, 12, 12]);
    expect(QUESTS.map(q => q.objectives.map(({ label: _label, ...objective }) => objective))).toEqual([
      [{ type: 'find', targetId: 'poi_kestrel_hold' }],
      [{ type: 'kill', mobType: 'moor_bull', count: 6 }],
      [{ type: 'collect', itemId: 'stalker_pelt', count: 6 }],
      [{ type: 'find', targetId: 'poi_cairnfield' }],
      [{ type: 'kill', mobType: 'cairn_wight', count: 8 }],
      [{ type: 'kill', mobType: 'barrow_revenant', count: 1, spawnNetIdPrefix: 'z2_revenant' }],
      [{ type: 'kill', mobType: 'frostbound_raider', count: 6 }],
      [{ type: 'find', targetId: 'poi_barrowdeep' },
        { type: 'kill', mobType: 'cairn_thane', count: 1, spawnNetIdPrefix: 'bd_boss' }],
    ]);
  });

  it('makes every giver and turn-in available in the quest zone, including the opening hand-off', () => {
    expect(QUESTS.map(q => q.giverNpcId)).toEqual([
      'warden_kesk', 'sergeant_talma', 'quartermaster_ivet', 'scout_arren',
      'scout_arren', 'warden_kesk', 'sergeant_talma', 'warden_kesk',
    ]);
    for (const q of QUESTS) {
      expect(q.turnInNpcId).toBe(q === QUESTS[0] ? 'scout_arren' : q.giverNpcId);
      for (const id of [q.giverNpcId, q.turnInNpcId]) {
        expect(NPCS[id].zoneId).toBe(q.zoneId);
        expect(NPCS[id].questIds).toContain(q.id);
      }
    }
    expect(NPCS.warden_kesk.questIds).toEqual([ids[0], ids[5], ids[7]]);
    expect(NPCS.scout_arren.questIds).toEqual([ids[0], ids[3], ids[4]]);
    expect(NPCS.sergeant_talma.questIds).toEqual([ids[1], ids[6]]);
    expect(NPCS.quartermaster_ivet.questIds).toEqual([ids[2]]);
    expect(NPCS.quartermaster_ivet.vendorItemIds).toEqual(['baked_bread', 'spring_water', 'roasted_boar']);
    expect(QUESTS[0].text).toContain('report to Scout Arren in the hold yard');
  });

  it('resolves objectives to reachable Zone 2 content within the level budget', () => {
    const barrowdeep = DUNGEONS.find(d => d.id === 'barrowdeep')!;
    expect(barrowdeep.entrance.zoneId).toBe(2);
    for (const q of QUESTS) {
      for (const obj of q.objectives) {
        if (obj.type === 'find') expect(WAYPOINTS[obj.targetId].zoneId).toBe(2);
        if (obj.type === 'collect') {
          expect(ZONE2_ITEMS.map(i => i.id)).toContain(obj.itemId);
          expect(ZONE2_MOBS.some(m => m.lootTable?.some(l => l.itemId === obj.itemId && l.chance > 0)
            && SPAWNS.some(s => s.zoneId === 2 && s.mobType === m.mobType))).toBe(true);
        }
        if (obj.type === 'kill') {
          expect(ZONE2_MOBS.map(m => m.mobType)).toContain(obj.mobType);
          expect(MOBS[obj.mobType].level).toBeLessThanOrEqual((q.minLevel ?? 7) + 1);
          const spawns = obj.mobType === barrowdeep.bossMobType ? barrowdeep.spawns : SPAWNS.filter(s => s.zoneId === 2);
          expect(spawns.some(s => s.mobType === obj.mobType
            && (!obj.spawnNetIdPrefix || s.netId.startsWith(obj.spawnNetIdPrefix)))).toBe(true);
        }
      }
    }
    expect(barrowdeep.spawns.find(s => s.netId === 'bd_boss')?.mobType).toBe('cairn_thane');
  });

  it('adds only one isolated collect stack, with the same drop at both stalker camps', () => {
    expect(ZONE2_ITEMS).toEqual([{
      id: 'stalker_pelt', name: 'Moor Stalker Pelt', icon: '\u{1F43E}', type: 'quest', stack: 20, quality: 'common',
    }]);
    expect(MOBS.moor_stalker.lootTable).toContainEqual({ itemId: 'stalker_pelt', chance: 0.6, min: 1, max: 1 });
    const camps = SPAWNS.filter(s => s.mobType === 'moor_stalker');
    expect(camps).toHaveLength(2);
    expect(camps.reduce((n, s) => n + s.count, 0)).toBe(11);
    expect(ZONE1_QUESTS.flatMap(q => q.objectives).some(o => o.type === 'collect' && o.itemId === 'stalker_pelt')).toBe(false);
  });

  it('keeps copper non-decreasing, uses existing rewards and leaves game XP disabled', () => {
    expect(QUESTS.map(q => q.reward.copper)).toEqual([80, 280, 320, 320, 380, 450, 480, 750]);
    QUESTS.forEach((q, i) => {
      if (i > 0) expect(q.reward.copper).toBeGreaterThanOrEqual(QUESTS[i - 1].reward.copper!);
      expect(q.reward.gameXp).toBeGreaterThanOrEqual(400);
      expect(q.reward.gameXp).toBeLessThanOrEqual(1400);
      for (const id of q.reward.itemIds ?? []) {
        expect(ITEMS[id]).toBeDefined();
        expect(ZONE2_ITEMS.some(item => item.id === id)).toBe(false);
      }
    });
    for (const q of QUESTS.slice(1, 7)) expect(q.reward.itemIds).toEqual(['stew']);
    expect(QUESTS[7].reward.itemIds).toHaveLength(1);
    expect(ITEMS[QUESTS[7].reward.itemIds![0]].quality).toBe('uncommon');
    expect(GAME_XP_ENABLED).toBe(false);
  });
});

describe('quest validation rejects broken content', () => {
  it('rejects a missing hand-off turn-in backlink', () => {
    const npc = NPCS.scout_arren;
    const original = npc.questIds;
    try {
      npc.questIds = original.filter(id => id !== ids[0]);
      expect(validateContent()).toContain(`quest ${ids[0]}: turn-in scout_arren does not list it in questIds`);
    } finally { npc.questIds = original; }
  });

  it('rejects collecting a different zone catalog item even if local mobs drop it', () => {
    const q = QUESTS[2];
    const original = q.objectives;
    try {
      q.objectives = [{ type: 'collect', itemId: 'linen_scrap', count: 6, label: 'Invalid cross-zone stack' }];
      expect(validateContent()).toContain(`quest ${q.id}: collect item linen_scrap does not belong to quest zone 2`);
    } finally { q.objectives = original; }
  });

  it.each(['warden_kesk', 'scout_arren'])('rejects a different-zone giver or turn-in: %s', id => {
    const npc = NPCS[id];
    const original = npc.zoneId;
    try {
      npc.zoneId = 1;
      expect(validateContent()).toContain(`quest ${ids[0]}: npc ${id} is not in quest zone 2`);
    } finally { npc.zoneId = original; }
  });

  it('rejects a different-zone find target', () => {
    const wp = WAYPOINTS.poi_kestrel_hold;
    const original = wp.zoneId;
    try {
      wp.zoneId = 1;
      expect(validateContent()).toContain(`quest ${ids[0]}: waypoint ${wp.id} is not in quest zone 2`);
    } finally { wp.zoneId = original; }
  });

  it('leaves the full content graph valid', () => expect(validateContent()).toEqual([]));
});
