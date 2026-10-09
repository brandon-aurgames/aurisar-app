import { matchesSearchExpanded } from './searchRank';

/**
 * Resolve favourite IDs against the catalog, dropping stale/deleted ids,
 * then optionally filter by search. Pagination and counts must use these
 * arrays — not the raw ID list — so "Show more" cannot expand into ghosts.
 */
export function resolveMatched(ids, allExById, query) {
  const resolved = [];
  for (const id of ids || []) {
    const ex = allExById?.[id];
    if (ex) resolved.push(ex);
  }
  const q = (query || "").trim();
  const matched = q ? resolved.filter(ex => matchesSearchExpanded(ex, q)) : resolved;
  return { resolved, matched };
}

export function countMeta(matchedLen, totalLen, query) {
  const q = (query || "").trim();
  if (!totalLen) return null;
  if (!q) return String(totalLen);
  return `${matchedLen} of ${totalLen}`;
}
