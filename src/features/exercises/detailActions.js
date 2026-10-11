import { planEntry } from './planEntry';

/**
 * Workout-builder payload from the detail sheet's "Add to Workout".
 *
 * Intentional fallbacks (same contract as `cartEntry`, kept on purpose):
 * - `sets` / `reps` fall back to 3 × 10 when the exercise has no defaults.
 * - `weightPct` falls back to 100 (normal intensity) when unset.
 * - `weightLbs`, `durationMin`, `distanceMi`, `hrZone` are null when the
 *   exercise has no matching default — the builder fills them at log time.
 *
 * Custom defaults (weight, intensity, distance, HR, duration) are copied
 * through when present. Timed / no-sets catalog rows use this same shape;
 * the live-workout path is what treats `NO_SETS_EX_IDS` as duration-based.
 * Rest day is not offered as Add to Workout (`offersAddToWorkout`).
 */
export function detailWorkoutEntry(ex) {
  return {
    exId: ex.id,
    sets: ex.defaultSets != null ? ex.defaultSets : 3,
    reps: ex.defaultReps != null ? ex.defaultReps : 10,
    weightLbs: ex.defaultWeightLbs || null,
    durationMin: ex.defaultDurationMin || null,
    weightPct: ex.defaultWeightPct != null ? ex.defaultWeightPct : 100,
    distanceMi: ex.defaultDistanceMi || null,
    hrZone: ex.defaultHrZone || null,
  };
}

export function offersAddToWorkout(ex) {
  return !!ex && ex.id !== "rest_day";
}

export function detailLogArgs(ex) {
  return { origin: { type: "detail", ex } };
}

export function detailPlanEntry(ex, chosenClass, allExById) {
  return planEntry(ex, chosenClass, allExById);
}
