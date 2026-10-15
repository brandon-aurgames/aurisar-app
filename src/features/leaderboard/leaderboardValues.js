import { comparePbBoardValues, pbBoardValue } from '../../utils/pbBoardValue';

export const LB_PB_BOARDS = {
  bench_1rm: { kind: 'weight', keys: ['bench', 'bench_press'] },
  squat_1rm: { kind: 'weight', keys: ['squat', 'barbell_back_squat'] },
  deadlift_1rm: { kind: 'weight', keys: ['deadlift', 'barbell_deadlift'] },
  ohp_1rm: { kind: 'weight', keys: ['overhead_press', 'ohp'] },
  pullup_reps: { kind: 'reps', keys: ['pull_up', 'pullups'] },
  pushup_reps: { kind: 'reps', keys: ['pushup', 'push_up', 'pushups'] },
  run_pace: { kind: 'pace', keys: ['running', 'treadmill_run', 'run'] },
};

export function pickExercisePb(pbs, keys) {
  if (!pbs) return null;
  for (const key of keys) {
    if (pbs[key]) return pbs[key];
  }
  return null;
}

export function getRowVal(row, filterId) {
  if (filterId === 'overall_xp') return row.total_xp || 0;
  if (filterId === 'weekly_xp') return row.weekly_xp || 0;
  if (filterId === 'streak') return row.streak || 0;
  const board = LB_PB_BOARDS[filterId];
  if (!board) return null;
  return pbBoardValue(pickExercisePb(row.exercise_pbs, board.keys), board.kind);
}

export function getRowPb(row, filterId) {
  const board = LB_PB_BOARDS[filterId];
  if (!board) return null;
  const pb = pickExercisePb(row.exercise_pbs, board.keys);
  return pbBoardValue(pb, board.kind) == null ? null : pb;
}

export function rowQualifiesForBoard(row, filterId) {
  if (filterId === 'overall_xp' || filterId === 'weekly_xp') return true;
  const v = getRowVal(row, filterId);
  if (filterId === 'streak') return v > 0;
  return v != null;
}

export function sortLeaderboardRows(rows, filterId) {
  const board = LB_PB_BOARDS[filterId];
  return (rows || []).slice()
    .filter(row => rowQualifiesForBoard(row, filterId))
    .sort((a, b) => {
      const av = getRowVal(a, filterId);
      const bv = getRowVal(b, filterId);
      if (board) return comparePbBoardValues(av, bv, board.kind);
      return (bv || 0) - (av || 0);
    });
}
