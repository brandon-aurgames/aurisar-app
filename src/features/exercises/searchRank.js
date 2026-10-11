/**
 * Exercise search ranking.
 *
 * Match quality (best first): exact name → name prefix → word prefix →
 * name substring → muscle / equipment. Favourites and recents sort ahead
 * of equally-matched rows. An empty query matches everything and does
 * not impose an order.
 */

function fieldKind(field, q) {
  if (!field) return null;
  if (field === q) return 0;
  if (field.startsWith(q)) return 1;
  if (field.split(/[\s/_-]+/).some(w => w.startsWith(q))) return 2;
  if (field.includes(q)) return 3;
  return null;
}

function muscleText(ex) {
  return (ex.muscleGroup || "").toLowerCase().trim().replace(/_/g, " ");
}

/** 0–3 for a name hit, 4 for muscle/equipment, null for no match. */
export function searchMatchKind(ex, rawQuery) {
  const q = (rawQuery || "").toLowerCase().trim();
  if (!q) return 0;
  const nameKind = fieldKind((ex.name || "").toLowerCase(), q);
  if (nameKind != null) return nameKind;
  if (fieldKind(muscleText(ex), q) != null) return 4;
  if (fieldKind((ex.equipment || "").toLowerCase(), q) != null) return 4;
  return null;
}

export function matchesSearchExpanded(ex, query) {
  return searchMatchKind(ex, query) != null;
}

/**
 * Sort key: [kind, favRank, recentRank, name]. Lower is better.
 * favRank / recentRank are 0 when the exercise is in that set.
 */
export function searchSortKey(ex, query, favSet, recentSet) {
  const kind = searchMatchKind(ex, query);
  if (kind == null) return [Infinity, 1, 1, ex.name || ""];
  return [
    kind,
    favSet && favSet.has(ex.id) ? 0 : 1,
    recentSet && recentSet.has(ex.id) ? 0 : 1,
    (ex.name || "").toLowerCase(),
  ];
}

export function compareSearchKeys(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0;
}

export function rankSearch(exercises, query, favSet, recentSet) {
  const q = (query || "").trim();
  if (!q) return exercises;
  const keyed = [];
  for (const ex of exercises) {
    if (!matchesSearchExpanded(ex, q)) continue;
    keyed.push({ ex, key: searchSortKey(ex, q, favSet, recentSet) });
  }
  keyed.sort((a, b) => compareSearchKeys(a.key, b.key));
  return keyed.map(k => k.ex);
}
