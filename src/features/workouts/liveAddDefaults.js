import { getExerciseHistory } from '../../utils/exerciseHistory';

const LIVE_ADD_FALLBACK = { sets: '3', reps: '10', weightLbs: '' };

/** Prefill live-add rows from the newest log session; else 3×10. */
export function liveAddDefaultsFromLog(log, exId) {
  const last = getExerciseHistory(log, exId, 1).at(-1);
  if (!last) return { ...LIVE_ADD_FALLBACK };
  return {
    sets: last.sets ? String(last.sets) : LIVE_ADD_FALLBACK.sets,
    reps: last.reps ? String(last.reps) : LIVE_ADD_FALLBACK.reps,
    weightLbs: last.weightLbs != null && last.weightLbs !== '' ? String(last.weightLbs) : '',
  };
}
