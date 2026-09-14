import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SS_MAX,
  normalizeSupersetGroups,
  migrateSupersetWith,
  groupStaged,
  ungroup,
  leaveGroup,
  canMerge,
  mergeOnto,
  reorderExercise,
  moveExercise,
  moveGroup,
  removeExercise,
  adjacentGroupId,
  memberBadge,
  groupLetter,
  isGroupStart,
  groupedExIds,
  eachRun,
  membersOf,
  remapGroupIds,
} from '../supersetModel';

function ex(id, extra = {}) {
  return { exId: id, sets: 3, reps: 10, ...extra };
}

describe('migrateSupersetWith / normalize', () => {
  it('turns a bidirectional index pair into a shared ssGroupId and strips the pointer', () => {
    const list = [
      ex('bench', { supersetWith: 1 }),
      ex('row', { supersetWith: 0 }),
      ex('squat'),
    ];
    const out = normalizeSupersetGroups(list);
    expect(out[0].ssGroupId).toBeTruthy();
    expect(out[0].ssGroupId).toBe(out[1].ssGroupId);
    expect(out[2].ssGroupId).toBeFalsy();
    expect(out.every(e => !('supersetWith' in e))).toBe(true);
  });

  it('compacts non-adjacent pair members into one run', () => {
    const list = [
      ex('a', { supersetWith: 2 }),
      ex('solo'),
      ex('b', { supersetWith: 0 }),
    ];
    const out = normalizeSupersetGroups(list);
    expect(out.map(e => e.exId)).toEqual(['a', 'b', 'solo']);
    expect(out[0].ssGroupId).toBe(out[1].ssGroupId);
  });

  it('drops a singleton group', () => {
    const out = normalizeSupersetGroups([ex('a', { ssGroupId: 'ss-orphan' }), ex('b')]);
    expect(out[0].ssGroupId).toBeFalsy();
  });

  it('is a no-op on an already-normalized list', () => {
    const once = normalizeSupersetGroups([
      ex('bench', { supersetWith: 1 }),
      ex('row', { supersetWith: 0 }),
    ]);
    const twice = normalizeSupersetGroups(once);
    expect(twice.map(e => e.exId)).toEqual(once.map(e => e.exId));
    expect(twice[0].ssGroupId).toBe(once[0].ssGroupId);
  });

  it('ignores a dangling supersetWith index', () => {
    const out = migrateSupersetWith([ex('a', { supersetWith: 9 })]);
    expect(out[0].ssGroupId).toBeFalsy();
    expect('supersetWith' in out[0]).toBe(false);
  });
});

describe('groupStaged / ungroup / leaveGroup', () => {
  it('groups two or more selected indices under one id and pulls them together', () => {
    const list = [ex('a'), ex('b'), ex('c'), ex('d')];
    const out = groupStaged(list, [0, 2, 3]);
    expect(out.slice(0, 3).every(e => e.ssGroupId && e.ssGroupId === out[0].ssGroupId)).toBe(true);
    expect(out.map(e => e.exId)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('refuses more than SS_MAX members in a fresh group', () => {
    const list = [ex('a'), ex('b'), ex('c'), ex('d'), ex('e')];
    const out = groupStaged(list, [0, 1, 2, 3, 4]);
    expect(out).toBe(list);
  });

  it('joins staged rows onto an adjacent group when there is room', () => {
    const grouped = groupStaged([ex('a'), ex('b'), ex('c')], [0, 1]);
    const gid = grouped[0].ssGroupId;
    expect(adjacentGroupId(grouped, [2])).toBe(gid);
    const out = groupStaged(grouped, [2], gid);
    expect(membersOf(out, gid)).toHaveLength(3);
  });

  it('ungroup clears every member of that id', () => {
    const grouped = groupStaged([ex('a'), ex('b'), ex('c')], [0, 1]);
    const out = ungroup(grouped, grouped[0].ssGroupId);
    expect(out.every(e => !e.ssGroupId)).toBe(true);
  });

  it('leaveGroup parks the deserter just below the remaining run', () => {
    const grouped = groupStaged([ex('a'), ex('b'), ex('c'), ex('d')], [0, 1, 2]);
    const out = leaveGroup(grouped, 0);
    expect(out.map(e => e.exId)).toEqual(['b', 'c', 'a', 'd']);
    expect(out[0].ssGroupId).toBe(out[1].ssGroupId);
    expect(out[2].ssGroupId).toBeFalsy();
  });
});

describe('mergeOnto / canMerge', () => {
  it('dropping one card onto another creates a group of two', () => {
    const list = [ex('a'), ex('b'), ex('c')];
    expect(canMerge(list, 0, 2)).toBe(true);
    const out = mergeOnto(list, 0, 2);
    expect(out.map(e => e.exId)).toEqual(['b', 'c', 'a']);
    expect(out[1].ssGroupId).toBe(out[2].ssGroupId);
  });

  it('will not merge a card onto a teammate or overflow SS_MAX', () => {
    const four = groupStaged([ex('a'), ex('b'), ex('c'), ex('d'), ex('e')], [0, 1, 2, 3]);
    expect(canMerge(four, 0, 1)).toBe(false);
    expect(canMerge(four, 4, 0)).toBe(false);
    expect(mergeOnto(four, 4, 0)).toBe(four);
  });
});

describe('reorder / move', () => {
  it('keeps the historical splice contract: from 0 onto 2 lands after the original 2', () => {
    const out = reorderExercise([ex('a'), ex('b'), ex('c'), ex('d')], 0, 2);
    expect(out.map(e => e.exId)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('dropping a member away from its run leaves the group', () => {
    const grouped = groupStaged([ex('a'), ex('b'), ex('c')], [0, 1]);
    const out = reorderExercise(grouped, 0, 2);
    expect(out[out.length - 1].exId).toBe('a');
    expect(out[out.length - 1].ssGroupId).toBeFalsy();
    expect(out.filter(e => e.ssGroupId)).toHaveLength(0); // pair dissolved
  });

  it('dropping between two teammates joins their group', () => {
    const grouped = groupStaged([ex('a'), ex('b'), ex('c')], [0, 1]);
    const out = reorderExercise(grouped, 2, 1);
    expect(out.every(e => e.ssGroupId && e.ssGroupId === out[0].ssGroupId)).toBe(true);
    expect(out.map(e => e.exId)).toEqual(['a', 'c', 'b']);
  });

  it('moveExercise only swaps inside a run', () => {
    const grouped = groupStaged([ex('a'), ex('b'), ex('c')], [0, 1]);
    expect(moveExercise(grouped, 0, 1).map(e => e.exId)).toEqual(['b', 'a', 'c']);
    expect(moveExercise(grouped, 1, 1)).toBe(grouped); // would leave the run
  });

  it('ungrouped moveExercise jumps over a neighbouring run instead of splitting it', () => {
    const grouped = groupStaged([ex('a'), ex('b'), ex('c')], [0, 1]);
    expect(moveExercise(grouped, 2, -1).map(e => e.exId)).toEqual(['c', 'a', 'b']);
  });

  it('remapGroupIds mints a fresh id shared by the same members', () => {
    const grouped = groupStaged([ex('a'), ex('b'), ex('c')], [0, 1]);
    const out = remapGroupIds(grouped);
    expect(out[0].ssGroupId).toBeTruthy();
    expect(out[0].ssGroupId).not.toBe(grouped[0].ssGroupId);
    expect(out[0].ssGroupId).toBe(out[1].ssGroupId);
    expect(out[2].ssGroupId).toBeFalsy();
  });

  it('moveGroup steps over a neighbouring group as a unit', () => {
    let list = groupStaged([ex('a'), ex('b'), ex('c'), ex('d')], [0, 1]);
    list = groupStaged(list, [2, 3]);
    const gA = list[0].ssGroupId;
    const down = moveGroup(list, gA, 1);
    expect(down.map(e => e.exId)).toEqual(['c', 'd', 'a', 'b']);
    const up = moveGroup(down, gA, -1);
    expect(up.map(e => e.exId)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('removeExercise', () => {
  it('dissolves a pair when one member is deleted and remaps nothing by index', () => {
    const grouped = groupStaged([ex('a'), ex('b'), ex('c')], [0, 1]);
    const out = removeExercise(grouped, 0);
    expect(out.map(e => e.exId)).toEqual(['b', 'c']);
    expect(out.every(e => !e.ssGroupId)).toBe(true);
  });
});

describe('labels / runs / history helper', () => {
  it('letters groups A, B and badges A1 A2', () => {
    let list = groupStaged([ex('a'), ex('b'), ex('c'), ex('d')], [0, 1]);
    list = groupStaged(list, [2, 3]);
    expect(groupLetter(list, list[0].ssGroupId)).toBe('A');
    expect(groupLetter(list, list[2].ssGroupId)).toBe('B');
    expect(memberBadge(list, 0)).toBe('A1');
    expect(memberBadge(list, 1)).toBe('A2');
    expect(isGroupStart(list, 0)).toBe(true);
    expect(isGroupStart(list, 1)).toBe(false);
  });

  it('eachRun yields grouped runs then solos', () => {
    const list = groupStaged([ex('a'), ex('b'), ex('c')], [0, 1]);
    const runs = [];
    eachRun(list, (run, gid) => runs.push({ ids: run.map(e => e.exId), gid: !!gid }));
    expect(runs).toEqual([
      { ids: ['a', 'b'], gid: true },
      { ids: ['c'], gid: false },
    ]);
  });

  it('groupedExIds covers both legacy pairs and ssGroupId', () => {
    expect([...groupedExIds([
      ex('bench', { supersetWith: 1 }),
      ex('row', { supersetWith: 0 }),
      ex('squat'),
    ])].sort()).toEqual(['bench', 'row']);
    const grouped = groupStaged([ex('x'), ex('y')], [0, 1]);
    expect([...groupedExIds(grouped)].sort()).toEqual(['x', 'y']);
  });

  it('SS_MAX is 4', () => {
    expect(SS_MAX).toBe(4);
  });
});
