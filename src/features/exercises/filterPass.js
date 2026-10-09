import { muscleKeys, typeKeys, equipKeys } from './matchesFacets';
import { matchesSearchExpanded, searchSortKey, compareSearchKeys } from './searchRank';

/**
 * One walk over the catalog: the filtered list plus ignore-self facet
 * counts. Same OR-within / AND-across rule as matchesFacets, but the
 * three count maps and the result list are built together so the library
 * and the workout picker do not rescan ~1,500 rows four times.
 *
 * A facet never constrains its own counts — that is what keeps
 * multi-select inside a facet reading as OR.
 */
export function filterAndCount(exercises, {
  query = "",
  muscleSet,
  typeSet,
  equipSet,
  favSet,
  recentSet,
} = {}) {
  const list = [];
  const muscleCounts = new Map();
  const typeCounts = new Map();
  const equipCounts = new Map();
  const q = (query || "").trim();
  const hasMuscle = !!(muscleSet && muscleSet.size);
  const hasType = !!(typeSet && typeSet.size);
  const hasEquip = !!(equipSet && equipSet.size);

  for (const ex of exercises) {
    if (!ex || ex.id === "rest_day") continue;
    if (q && !matchesSearchExpanded(ex, q)) continue;

    const mKeys = muscleKeys(ex);
    const tKeys = typeKeys(ex);
    const eKeys = equipKeys(ex);
    const muscleOk = !hasMuscle || mKeys.some(k => muscleSet.has(k));
    const typeOk = !hasType || tKeys.some(k => typeSet.has(k));
    const equipOk = !hasEquip || eKeys.some(k => equipSet.has(k));

    // Ignore-self counts: every other constraint, not this facet.
    if (typeOk && equipOk) {
      for (const k of mKeys) if (k) muscleCounts.set(k, (muscleCounts.get(k) || 0) + 1);
    }
    if (muscleOk && equipOk) {
      for (const k of tKeys) if (k) typeCounts.set(k, (typeCounts.get(k) || 0) + 1);
    }
    if (muscleOk && typeOk) {
      for (const k of eKeys) if (k) equipCounts.set(k, (equipCounts.get(k) || 0) + 1);
    }

    if (muscleOk && typeOk && equipOk) list.push(ex);
  }

  if (q) {
    list.sort((a, b) => compareSearchKeys(
      searchSortKey(a, q, favSet, recentSet),
      searchSortKey(b, q, favSet, recentSet),
    ));
  }

  return { list, muscleCounts, typeCounts, equipCounts };
}
