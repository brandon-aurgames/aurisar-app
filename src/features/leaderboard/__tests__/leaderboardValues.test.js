import { describe, expect, it } from 'vitest';
import { getRowPb, getRowVal, sortLeaderboardRows } from '../leaderboardValues';

const typed = {
  user_id: 'typed',
  exercise_pbs: {
    bench: { type: 'Strength 1RM', value: 225 },
    squat: { type: 'Heaviest Weight', value: 315 },
    deadlift: { type: 'Strength 1RM', value: 405 },
    ohp: { type: 'Strength 1RM', value: 135 },
    pullups: { type: 'Max Reps Per 1 Set', value: 20 },
    pushup: { type: 'Max Reps Per 1 Set', value: 40 },
    run: { type: 'Cardio Pace', value: 8.0 },
  },
};

const legacy = {
  user_id: 'legacy',
  exercise_pbs: {
    bench_press: { weight: 185 },
    barbell_back_squat: { weight: 275 },
    barbell_deadlift: { weight: 315 },
    overhead_press: { weight: 115 },
    pull_up: { reps: 12 },
    pushups: { reps: 30 },
    running: { type: 'cardio', value: 9.03 },
  },
};

const invalid = {
  user_id: 'bad',
  exercise_pbs: {
    bench: { type: 'Strength 1RM', value: 'nope' },
    run: { type: 'cardio' },
    pushup: { type: 'Max Reps Per 1 Set' },
  },
};

describe('leaderboard row values', () => {
  it('covers each board with {type,value} and with legacy shapes', () => {
    expect(getRowVal(typed, 'bench_1rm')).toBe(225);
    expect(getRowVal(legacy, 'bench_1rm')).toBe(185);
    expect(getRowVal(typed, 'squat_1rm')).toBe(315);
    expect(getRowVal(legacy, 'squat_1rm')).toBe(275);
    expect(getRowVal(typed, 'deadlift_1rm')).toBe(405);
    expect(getRowVal(legacy, 'deadlift_1rm')).toBe(315);
    expect(getRowVal(typed, 'ohp_1rm')).toBe(135);
    expect(getRowVal(legacy, 'ohp_1rm')).toBe(115);
    expect(getRowVal(typed, 'pullup_reps')).toBe(20);
    expect(getRowVal(legacy, 'pullup_reps')).toBe(12);
    expect(getRowVal(typed, 'pushup_reps')).toBe(40);
    expect(getRowVal(legacy, 'pushup_reps')).toBe(30);
    expect(getRowVal(typed, 'run_pace')).toBe(8.0);
    expect(getRowVal(legacy, 'run_pace')).toBe(9.03);
  });

  it('matches the catalog pushup id and keeps invalid PBs off the board', () => {
    expect(getRowVal({ exercise_pbs: { pushup: { type: 'Max Reps Per 1 Set', value: 45 } } }, 'pushup_reps')).toBe(45);
    expect(getRowVal(invalid, 'bench_1rm')).toBeNull();
    expect(getRowVal(invalid, 'run_pace')).toBeNull();
    expect(getRowVal(invalid, 'pushup_reps')).toBeNull();
    expect(sortLeaderboardRows([typed, invalid], 'bench_1rm').map(r => r.user_id)).toEqual(['typed']);
  });

  it('ranks pace (and assisted-style) boards lowest first and treats legacy cardio as pace', () => {
    const slower = { user_id: 'slow', exercise_pbs: { run: { type: 'cardio', value: 10 } } };
    const faster = { user_id: 'fast', exercise_pbs: { run: { type: 'Cardio Pace', value: 7 } } };
    expect(sortLeaderboardRows([slower, faster], 'run_pace').map(r => r.user_id)).toEqual(['fast', 'slow']);
    expect(sortLeaderboardRows([legacy, typed], 'bench_1rm').map(r => r.user_id)).toEqual(['typed', 'legacy']);
  });

  it('returns the stored PB object for formatPbValue', () => {
    expect(getRowPb(typed, 'bench_1rm')).toEqual({ type: 'Strength 1RM', value: 225 });
    expect(getRowPb(legacy, 'run_pace')).toEqual({ type: 'cardio', value: 9.03 });
    expect(getRowPb(invalid, 'bench_1rm')).toBeNull();
  });
});
