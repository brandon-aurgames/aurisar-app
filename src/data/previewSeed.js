export const PREVIEW_EXERCISE_PBS = {
  bench: { type: 'Strength 1RM', value: 185 },
  squat: { type: 'Strength 1RM', value: 205 },
  deadlift: { type: 'Strength 1RM', value: 225 },
  run: { type: 'Cardio Pace', value: 9.03 },
};

export const PREVIEW_RUNNING_PB = 9.03;

export function buildPreviewLog(now = Date.now()) {
  const daysAgo = n => new Date(now - n * 86400000).toISOString().slice(0, 10);
  const fmtDate = n => new Date(now - n * 86400000).toLocaleDateString();
  const fmtTime = () => '07:30 AM';
  const gid = s => `preview-grp-${s}`;
  const row = (extra) => ({
    weightPct: 100,
    hrZone: null,
    distanceMi: null,
    time: fmtTime(),
    ...extra,
  });
  return [
    row({ exercise: 'Bench Press', icon: '🏋️', exId: 'bench', sets: 4, reps: 8, weightLbs: 185, xp: 420, mult: 1.12, date: fmtDate(1), dateKey: daysAgo(1), sourceGroupId: gid('a') }),
    row({ exercise: 'Bench Press', icon: '🏋️', exId: 'bench', sets: 1, reps: 1, weightLbs: 185, xp: 80, mult: 1.12, date: fmtDate(1), dateKey: daysAgo(1), sourceGroupId: gid('a') }),
    row({ exercise: 'Overhead Press', icon: '🏋️', exId: 'ohp', sets: 3, reps: 10, weightLbs: 115, xp: 310, mult: 1.12, date: fmtDate(1), dateKey: daysAgo(1), sourceGroupId: gid('a') }),
    row({ exercise: 'Running', icon: '🏃', exId: 'run', sets: 1, reps: 28, weightLbs: null, distanceMi: 3.1, xp: 380, mult: 0.94, date: fmtDate(3), dateKey: daysAgo(3), sourceGroupId: gid('b') }),
    row({ exercise: 'Deadlift', icon: '🏋️', exId: 'deadlift', sets: 4, reps: 6, weightLbs: 225, xp: 580, mult: 1.12, date: fmtDate(5), dateKey: daysAgo(5), sourceGroupId: gid('c') }),
    row({ exercise: 'Deadlift', icon: '🏋️', exId: 'deadlift', sets: 1, reps: 1, weightLbs: 225, xp: 90, mult: 1.12, date: fmtDate(5), dateKey: daysAgo(5), sourceGroupId: gid('c') }),
    row({ exercise: 'Pull-Up', icon: '🦾', exId: 'pullups', sets: 3, reps: 10, weightLbs: null, xp: 290, mult: 1.12, date: fmtDate(5), dateKey: daysAgo(5), sourceGroupId: gid('c') }),
    row({ exercise: 'Squat', icon: '🏋️', exId: 'squat', sets: 4, reps: 8, weightLbs: 205, xp: 510, mult: 1.12, date: fmtDate(10), dateKey: daysAgo(10), sourceGroupId: gid('e') }),
    row({ exercise: 'Squat', icon: '🏋️', exId: 'squat', sets: 1, reps: 1, weightLbs: 205, xp: 85, mult: 1.12, date: fmtDate(10), dateKey: daysAgo(10), sourceGroupId: gid('e') }),
  ];
}

function lbRow(partial) {
  return {
    name_visibility: { displayName: ['app', 'game'], realName: ['hide'] },
    is_me: false,
    ...partial,
  };
}

export function buildPreviewLeaderboard() {
  return [
    lbRow({
      user_id: 'f1', public_id: 'VK9R3M', player_name: 'IronValkyrie', first_name: 'Sarah', last_name: 'Chen',
      chosen_class: 'warrior', total_xp: 420000, level: 8, streak: 31, state: 'NY', country: 'United States', gym: "Gold's Gym",
      exercise_pbs: {
        bench: { type: 'Strength 1RM', value: 185 },
        squat: { type: 'Strength 1RM', value: 275 },
        deadlift: { type: 'Strength 1RM', value: 315 },
      },
    }),
    lbRow({
      user_id: 'f5', public_id: 'PH3L9F', player_name: 'PhantomLift', first_name: 'Jake', last_name: 'Morrison',
      chosen_class: 'phantom', total_xp: 360000, level: 8, streak: 45, state: 'CO', country: 'United States', gym: '24 Hr Fitness',
      exercise_pbs: {
        bench: { type: 'Strength 1RM', value: 245 },
        squat: { type: 'Strength 1RM', value: 365 },
        deadlift: { type: 'Strength 1RM', value: 405 },
        pullups: { type: 'Max Reps Per 1 Set', value: 25 },
      },
    }),
    lbRow({
      user_id: 'preview', public_id: 'UQHDD2', player_name: 'Test Majiq', first_name: 'John', last_name: 'Majiq',
      chosen_class: 'tempest', total_xp: 320000, level: 7, streak: 3, state: 'KS', country: 'United States', gym: 'Lifetime Fitness',
      exercise_pbs: PREVIEW_EXERCISE_PBS,
      is_me: true,
    }),
    lbRow({
      user_id: 'f6', public_id: 'TT6B4K', player_name: 'TitanBreaker', first_name: 'Mike', last_name: 'OBrien',
      chosen_class: 'titan', total_xp: 210000, level: 6, streak: 18, state: 'OH', country: 'United States', gym: 'YMCA',
      exercise_pbs: {
        bench: { type: 'Strength 1RM', value: 315 },
        squat: { type: 'Strength 1RM', value: 455 },
        deadlift: { type: 'Strength 1RM', value: 500 },
      },
    }),
    lbRow({
      user_id: 'f2', public_id: 'ZN4K8W', player_name: 'ZenMaster_X', first_name: 'Marcus', last_name: 'Rivera',
      chosen_class: 'druid', total_xp: 155000, level: 5, streak: 14, state: 'CA', country: 'United States', gym: 'Equinox',
      exercise_pbs: {
        bench: { type: 'Strength 1RM', value: 135 },
        run: { type: 'Cardio Pace', value: 7.5 },
      },
    }),
    lbRow({
      user_id: 'f4', public_id: 'SW7A2R', player_name: 'SwiftArrow', first_name: 'Emily', last_name: 'Park',
      chosen_class: 'warden', total_xp: 105000, level: 4, streak: 22, state: 'FL', country: 'United States', gym: 'LA Fitness',
      exercise_pbs: {
        run: { type: 'Cardio Pace', value: 7.2 },
        pullups: { type: 'Max Reps Per 1 Set', value: 12 },
      },
    }),
    lbRow({
      user_id: 'f3', public_id: 'CR8M5T', player_name: 'CrushMode88', first_name: 'DeAndre', last_name: 'Williams',
      chosen_class: 'gladiator', total_xp: 58000, level: 3, streak: 7, state: 'TX', country: 'United States', gym: 'Planet Fitness',
      exercise_pbs: {
        bench: { type: 'Strength 1RM', value: 225 },
        squat: { type: 'Strength 1RM', value: 315 },
      },
    }),
    lbRow({
      user_id: 'f7', public_id: 'ST2E7X', player_name: 'StrikerElite', first_name: 'Aisha', last_name: 'Thompson',
      chosen_class: 'striker', total_xp: 22000, level: 2, streak: 5, state: 'WA', country: 'United States', gym: 'Home Gym',
      exercise_pbs: {
        pushup: { type: 'Max Reps Per 1 Set', value: 45 },
      },
    }),
  ];
}

export const PREVIEW_WORLD_RANKS = {
  f1: 1, f5: 2, preview: 3, f6: 4, f2: 5, f4: 6, f3: 7, f7: 8,
};

export const PREVIEW_SEED_EX_LOOKUP = {
  bench: { id: 'bench', name: 'Bench Press', category: 'strength', pbType: 'Strength 1RM' },
  squat: { id: 'squat', name: 'Squat', category: 'strength', pbType: 'Strength 1RM' },
  deadlift: { id: 'deadlift', name: 'Deadlift', category: 'strength', pbType: 'Strength 1RM' },
  run: { id: 'run', name: 'Running', category: 'cardio', pbType: 'Cardio Pace' },
  ohp: { id: 'ohp', name: 'Overhead Press', category: 'strength', pbType: 'Strength 1RM' },
  pullups: { id: 'pullups', name: 'Pullups', category: 'strength', pbType: 'Max Reps Per 1 Set' },
};
