import { muscleKeys, typeKeys, equipKeys } from './matchesFacets';
import { difficultyKeys, goalKeys, movementKeys } from './libraryFacets';
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
  difficultySet,
  goalSet,
  movementSet,
  favSet,
  recentSet,
} = {}) {
  const list = [];
  const muscleCounts = new Map();
  const typeCounts = new Map();
  const equipCounts = new Map();
  const difficultyCounts = new Map();
  const goalCounts = new Map();
  const movementCounts = new Map();
  const q = (query || "").trim();
  const hasMuscle = !!(muscleSet && muscleSet.size);
  const hasType = !!(typeSet && typeSet.size);
  const hasEquip = !!(equipSet && equipSet.size);
  const hasDiff = !!(difficultySet && difficultySet.size);
  const hasGoal = !!(goalSet && goalSet.size);
  const hasMove = !!(movementSet && movementSet.size);

  for (const ex of exercises) {
    if (!ex || ex.id === "rest_day") continue;
    if (q && !matchesSearchExpanded(ex, q)) continue;

    const mKeys = muscleKeys(ex);
    const tKeys = typeKeys(ex);
    const eKeys = equipKeys(ex);
    const dKeys = difficultyKeys(ex);
    const gKeys = goalKeys(ex);
    const vKeys = movementKeys(ex);
    const muscleOk = !hasMuscle || mKeys.some(k => muscleSet.has(k));
    const typeOk = !hasType || tKeys.some(k => typeSet.has(k));
    const equipOk = !hasEquip || eKeys.some(k => equipSet.has(k));
    const diffOk = !hasDiff || dKeys.some(k => difficultySet.has(k));
    const goalOk = !hasGoal || gKeys.some(k => goalSet.has(k));
    const moveOk = !hasMove || vKeys.some(k => movementSet.has(k));

    const othersExcept = skip => {
      if (skip !== "muscle" && !muscleOk) return false;
      if (skip !== "type" && !typeOk) return false;
      if (skip !== "equip" && !equipOk) return false;
      if (skip !== "diff" && !diffOk) return false;
      if (skip !== "goal" && !goalOk) return false;
      if (skip !== "move" && !moveOk) return false;
      return true;
    };

    // Ignore-self counts: every other constraint, not this facet.
    if (othersExcept("muscle")) {
      for (const k of mKeys) if (k) muscleCounts.set(k, (muscleCounts.get(k) || 0) + 1);
    }
    if (othersExcept("type")) {
      for (const k of tKeys) if (k) typeCounts.set(k, (typeCounts.get(k) || 0) + 1);
    }
    if (othersExcept("equip")) {
      for (const k of eKeys) if (k) equipCounts.set(k, (equipCounts.get(k) || 0) + 1);
    }
    if (othersExcept("diff")) {
      for (const k of dKeys) if (k) difficultyCounts.set(k, (difficultyCounts.get(k) || 0) + 1);
    }
    if (othersExcept("goal")) {
      for (const k of gKeys) if (k) goalCounts.set(k, (goalCounts.get(k) || 0) + 1);
    }
    if (othersExcept("move")) {
      for (const k of vKeys) if (k) movementCounts.set(k, (movementCounts.get(k) || 0) + 1);
    }

    if (muscleOk && typeOk && equipOk && diffOk && goalOk && moveOk) list.push(ex);
  }

  if (q) {
    const keyed = list.map(ex => ({ ex, key: searchSortKey(ex, q, favSet, recentSet) }));
    keyed.sort((a, b) => compareSearchKeys(a.key, b.key));
    list.length = 0;
    for (const row of keyed) list.push(row.ex);
  }

  return { list, muscleCounts, typeCounts, equipCounts, difficultyCounts, goalCounts, movementCounts };
}
