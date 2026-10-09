import { calcExercisePBs } from './xp';

/**
 * New PBs introduced by `newLog` relative to `oldLog`, by recomputing both
 * maps. Do not compare against a stored exercisePBs map — that can be stale
 * and would announce old bests as new on the first write after deploy.
 */
export function newPbsBetweenLogs(oldLog, newLog, exLookup) {
  const prev = calcExercisePBs(oldLog, exLookup);
  const next = calcExercisePBs(newLog, exLookup);
  const updates = {};
  for (const exId of Object.keys(next)) {
    const cur = next[exId];
    const old = prev[exId];
    if (cur && (!old || cur.value !== old.value)) updates[exId] = cur;
  }
  return updates;
}
