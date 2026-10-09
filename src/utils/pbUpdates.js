import { calcExercisePBs } from './xp';

function isLowerBetterPbType(type) {
  const t = String(type || '').toLowerCase();
  return t === 'cardio pace' || t === 'cardio' || t === 'assisted weight' || t === 'assisted' || t === 'fastest time';
}

function beatsEarlier(cur, old) {
  if (!cur || !old) return false;
  if (isLowerBetterPbType(cur.type)) return Number(cur.value) < Number(old.value);
  return Number(cur.value) > Number(old.value);
}

/**
 * New PBs introduced by `newLog` relative to `oldLog`, by recomputing both
 * maps. Announce only when the result beats an earlier logged result for
 * that exercise — a first-ever log is stored as the PB but is not announced.
 * Do not compare against a stored exercisePBs map — that can be stale.
 */
export function newPbsBetweenLogs(oldLog, newLog, exLookup) {
  const prev = calcExercisePBs(oldLog, exLookup);
  const next = calcExercisePBs(newLog, exLookup);
  const updates = {};
  for (const exId of Object.keys(next)) {
    const cur = next[exId];
    const old = prev[exId];
    if (beatsEarlier(cur, old)) updates[exId] = cur;
  }
  return updates;
}
