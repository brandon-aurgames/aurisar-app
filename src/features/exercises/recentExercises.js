import { entryTime } from './logEntryTime';

export const RECENT_COUNT = 5;
export const HOME_ROW_COUNT = 5;

/**
 * Most recent distinct catalog exercises from the log. Deleted custom
 * exercises linger in profile.log; skip ids the catalog cannot resolve.
 */
export function recentExerciseIds(log, allExById, now = Date.now(), limit = RECENT_COUNT) {
  const out = [];
  const seen = new Set();
  for (const entry of log || []) {
    if (!entry.exId || seen.has(entry.exId) || !allExById[entry.exId]) continue;
    seen.add(entry.exId);
    const t = entryTime(entry);
    const days = Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86400000)) : null;
    out.push({ ex: allExById[entry.exId], days });
    if (out.length >= limit) break;
  }
  return out;
}

export function resolveFavoriteExercises(ids, allExById, limit) {
  const out = [];
  for (const id of ids || []) {
    const ex = allExById[id];
    if (!ex) continue;
    out.push(ex);
    if (limit != null && out.length >= limit) break;
  }
  return out;
}
