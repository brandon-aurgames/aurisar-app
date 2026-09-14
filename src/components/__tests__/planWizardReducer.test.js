import { describe, it, expect } from 'vitest';
import { A, bDaysReducer, initBDays } from '../planWizardReducer';

function days(exs) {
  return [{ label: 'Day 1', exercises: exs }];
}
function ex(id, extra = {}) {
  return { exId: id, sets: 3, reps: 10, ...extra };
}

describe('plan wizard grouping', () => {
  it('initBDays migrates legacy supersetWith pairs', () => {
    const out = initBDays({
      editPlan: {
        days: days([
          ex('bench', { supersetWith: 1 }),
          ex('row', { supersetWith: 0 }),
          ex('squat'),
        ]),
      },
    });
    expect(out[0].exercises[0].ssGroupId).toBe(out[0].exercises[1].ssGroupId);
    expect(out[0].exercises.every(e => !('supersetWith' in e))).toBe(true);
  });

  it('GROUP_SUPERSET forms a 3-way run', () => {
    const state = days([ex('a'), ex('b'), ex('c')]);
    const next = bDaysReducer(state, { type: A.GROUP_SUPERSET, dayIdx: 0, indices: [0, 1, 2] });
    expect(next[0].exercises.every(e => e.ssGroupId && e.ssGroupId === next[0].exercises[0].ssGroupId)).toBe(true);
  });

  it('UNGROUP_SUPERSET clears the id', () => {
    const grouped = bDaysReducer(days([ex('a'), ex('b')]), { type: A.GROUP_SUPERSET, dayIdx: 0, indices: [0, 1] });
    const gid = grouped[0].exercises[0].ssGroupId;
    const next = bDaysReducer(grouped, { type: A.UNGROUP_SUPERSET, dayIdx: 0, gid });
    expect(next[0].exercises.every(e => !e.ssGroupId)).toBe(true);
  });

  it('REMOVE_EX dissolves a pair', () => {
    const grouped = bDaysReducer(days([ex('a'), ex('b'), ex('c')]), { type: A.GROUP_SUPERSET, dayIdx: 0, indices: [0, 1] });
    const next = bDaysReducer(grouped, { type: A.REMOVE_EX, dayIdx: 0, exIdx: 0 });
    expect(next[0].exercises.map(e => e.exId)).toEqual(['b', 'c']);
    expect(next[0].exercises.every(e => !e.ssGroupId)).toBe(true);
  });

  it('MOVE_SUPERSET_DOWN steps over a neighbouring group', () => {
    let state = bDaysReducer(days([ex('a'), ex('b'), ex('c'), ex('d')]), { type: A.GROUP_SUPERSET, dayIdx: 0, indices: [0, 1] });
    state = bDaysReducer(state, { type: A.GROUP_SUPERSET, dayIdx: 0, indices: [2, 3] });
    const gA = state[0].exercises[0].ssGroupId;
    const next = bDaysReducer(state, { type: A.MOVE_SUPERSET_DOWN, dayIdx: 0, gid: gA });
    expect(next[0].exercises.map(e => e.exId)).toEqual(['c', 'd', 'a', 'b']);
  });
});
