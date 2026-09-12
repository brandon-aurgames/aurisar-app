import { uid } from '../../utils/helpers';

/**
 * Workout / plan exercise grouping.
 *
 * The live app used a pairwise index pointer (`supersetWith`) that could
 * only ever describe two exercises and had to be remapped on every
 * reorder/remove. The Workout Builder mockup (PR #357) replaced that with a
 * shared group id so 2–4 neighbours can share one band.
 *
 * Persist `ssGroupId` on each member. `supersetWith` is still accepted on
 * load (recipes + old saves) and stripped by `normalizeSupersetGroups`.
 *
 * XP is unchanged: grouping is presentation + reorder cohesion only.
 */

export const SS_MAX = 4;

export function newGroupId() {
  return 'ss-' + uid();
}

export function groupIdOf(ex) {
  return ex && ex.ssGroupId ? ex.ssGroupId : null;
}

export function isGrouped(ex) {
  return !!(ex && (ex.ssGroupId || typeof ex.supersetWith === 'number'));
}

export function membersOf(list, gid) {
  if (!gid) return [];
  return list.filter(x => x.ssGroupId === gid);
}

export function groupOrder(list) {
  const seen = [];
  for (const x of list) {
    if (x.ssGroupId && seen.indexOf(x.ssGroupId) < 0) seen.push(x.ssGroupId);
  }
  return seen;
}

export function groupLetter(list, gid) {
  const i = groupOrder(list).indexOf(gid);
  return i < 0 ? '' : String.fromCharCode(65 + Math.min(25, i));
}

export function memberBadge(list, index) {
  const ex = list[index];
  if (!ex || !ex.ssGroupId) return String(index + 1);
  const mem = membersOf(list, ex.ssGroupId);
  return groupLetter(list, ex.ssGroupId) + (mem.indexOf(ex) + 1);
}

export function isGroupStart(list, index) {
  const ex = list[index];
  if (!ex) return false;
  if (ex.ssGroupId) return list.findIndex(x => x.ssGroupId === ex.ssGroupId) === index;
  return typeof ex.supersetWith === 'number' && ex.supersetWith > index;
}

/** Walk contiguous runs: a group is a maximal stretch of neighbours sharing a gid. */
export function eachRun(list, fn) {
  for (let i = 0; i < list.length;) {
    const g = list[i].ssGroupId || null;
    let j = i + 1;
    if (g) while (j < list.length && list[j].ssGroupId === g) j++;
    fn(list.slice(i, j), g, i);
    i = j;
  }
}

function stripLegacy(ex) {
  if (!ex || !('supersetWith' in ex)) return ex;
  const next = { ...ex };
  delete next.supersetWith;
  return next;
}

/**
 * Convert bidirectional `supersetWith` index pairs into `ssGroupId`s.
 * Already-grouped rows keep their id. Dangling indices are ignored.
 */
export function migrateSupersetWith(list) {
  const out = list.map(e => ({ ...e }));
  const claimed = new Set();
  for (let i = 0; i < out.length; i++) {
    if (claimed.has(i) || out[i].ssGroupId) continue;
    const partner = out[i].supersetWith;
    if (typeof partner !== 'number' || partner < 0 || partner >= out.length) continue;
    if (claimed.has(partner) || out[partner].ssGroupId) continue;
    const gid = newGroupId();
    out[i] = { ...out[i], ssGroupId: gid };
    out[partner] = { ...out[partner], ssGroupId: gid };
    claimed.add(i);
    claimed.add(partner);
  }
  return out.map(stripLegacy);
}

export function compactGroups(list) {
  const out = [];
  const placed = Object.create(null);
  for (const x of list) {
    if (!x.ssGroupId) {
      out.push(x);
      continue;
    }
    if (placed[x.ssGroupId]) continue;
    placed[x.ssGroupId] = 1;
    for (const y of membersOf(list, x.ssGroupId)) out.push(y);
  }
  return out;
}

/** Migrate pairs, drop singleton groups, keep members adjacent. */
export function normalizeSupersetGroups(list) {
  if (!Array.isArray(list) || list.length === 0) return list || [];
  let next = migrateSupersetWith(list);
  const n = Object.create(null);
  for (const x of next) {
    if (x.ssGroupId) n[x.ssGroupId] = (n[x.ssGroupId] || 0) + 1;
  }
  next = next.map(x => (x.ssGroupId && n[x.ssGroupId] < 2 ? { ...x, ssGroupId: undefined } : x));
  return compactGroups(next);
}

export function groupedExIds(list) {
  const ids = new Set();
  const gids = new Set();
  for (const ex of list) {
    if (ex.ssGroupId) gids.add(ex.ssGroupId);
    if (typeof ex.supersetWith === 'number') {
      if (ex.exId) ids.add(ex.exId);
      const partner = list[ex.supersetWith];
      if (partner && partner.exId) ids.add(partner.exId);
    }
  }
  for (const ex of list) {
    if (ex.ssGroupId && gids.has(ex.ssGroupId) && ex.exId) ids.add(ex.exId);
  }
  return ids;
}

export function adjacentGroupId(list, stagedIndices) {
  if (!stagedIndices.length) return null;
  const sorted = [...stagedIndices].sort((a, b) => a - b);
  const a = sorted[0];
  const b = sorted[sorted.length - 1];
  for (const nb of [list[a - 1], list[b + 1]]) {
    if (nb && nb.ssGroupId && membersOf(list, nb.ssGroupId).length + stagedIndices.length <= SS_MAX) {
      return nb.ssGroupId;
    }
  }
  return null;
}

export function groupStaged(list, indices, joinGid) {
  const staged = indices.filter(i => i >= 0 && i < list.length);
  if (staged.length < 2 && !joinGid) return list;
  if (joinGid && membersOf(list, joinGid).length + staged.length > SS_MAX) return list;
  if (!joinGid && staged.length > SS_MAX) return list;
  const gid = joinGid || newGroupId();
  const want = new Set(staged);
  const next = list.map((x, i) => (want.has(i) ? { ...x, ssGroupId: gid } : x));
  return normalizeSupersetGroups(next);
}

export function ungroup(list, gid) {
  if (!gid) return list;
  return normalizeSupersetGroups(list.map(x => (x.ssGroupId === gid ? { ...x, ssGroupId: undefined } : x)));
}

export function leaveGroup(list, index) {
  const ex = list[index];
  if (!ex || !ex.ssGroupId) return list;
  const gid = ex.ssGroupId;
  const rest = list.filter((_, i) => i !== index);
  const mem = rest.filter(x => x.ssGroupId === gid);
  const at = mem.length ? rest.indexOf(mem[mem.length - 1]) + 1 : rest.length;
  rest.splice(at, 0, { ...ex, ssGroupId: undefined });
  return normalizeSupersetGroups(rest);
}

export function canMerge(list, fromIdx, ontoIdx) {
  if (fromIdx === ontoIdx) return false;
  const src = list[fromIdx];
  const tgt = list[ontoIdx];
  if (!src || !tgt) return false;
  if (src.ssGroupId && src.ssGroupId === tgt.ssGroupId) return false;
  const tgtSize = tgt.ssGroupId ? membersOf(list, tgt.ssGroupId).length : 1;
  return tgtSize + 1 <= SS_MAX;
}

export function mergeOnto(list, fromIdx, ontoIdx) {
  if (!canMerge(list, fromIdx, ontoIdx)) return list;
  const tgt = list[ontoIdx];
  const gid = tgt.ssGroupId || newGroupId();
  const next = list.map((x, i) => (i === fromIdx || i === ontoIdx ? { ...x, ssGroupId: gid } : x));
  const item = next[fromIdx];
  const rest = next.filter((_, i) => i !== fromIdx);
  const mem = rest.filter(x => x.ssGroupId === gid);
  const at = rest.indexOf(mem[mem.length - 1]) + 1;
  rest.splice(at, 0, item);
  return normalizeSupersetGroups(rest);
}

function pastRun(arr, gid) {
  const mem = arr.filter(x => x.ssGroupId === gid);
  if (!mem.length) return arr.length;
  return arr.indexOf(mem[mem.length - 1]) + 1;
}

/**
 * Move one row. `toIdx` is the drop-target index in the pre-move list
 * (same contract as the old splice-based `reorderWbEx`).
 *
 * Membership follows the landing site: drop between teammates to join,
 * drop away from a run to leave it. A full group is skipped rather than
 * overflowed.
 */
export function reorderExercise(list, fromIdx, toIdx) {
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return list;
  if (fromIdx >= list.length || toIdx >= list.length) return list;
  const item = { ...list[fromIdx] };
  const rest = list.filter((_, i) => i !== fromIdx);
  const at = fromIdx < toIdx ? toIdx : toIdx; // splice(from) then splice(to) with original to
  // After removal, original toIdx still works the way Array#splice did in
  // reorderWbEx: insert AT toIdx in the post-removal array when from < to
  // actually needs toIdx-?  Old code:
  //   splice(from); splice(to, 0, moved) using the ORIGINAL toIdx.
  // [A,B,C,D] from 0 to 2 → splice(0) [B,C,D]; splice(2,0,A) [B,C,A,D]
  const insertAt = toIdx > rest.length ? rest.length : toIdx;
  const prev = rest[insertAt - 1];
  const next = rest[insertAt];
  const wasGid = item.ssGroupId || null;
  const between = prev && next && prev.ssGroupId && prev.ssGroupId === next.ssGroupId ? prev.ssGroupId : null;
  let dest = insertAt;
  if (between && between !== wasGid && membersOf(list.filter((_, i) => i !== fromIdx), between).length >= SS_MAX) {
    dest = pastRun(rest, between);
  } else if (between && between !== wasGid) {
    item.ssGroupId = between;
  } else {
    item.ssGroupId = wasGid && ((prev && prev.ssGroupId === wasGid) || (next && next.ssGroupId === wasGid))
      ? wasGid
      : undefined;
  }
  rest.splice(dest, 0, item);
  return normalizeSupersetGroups(rest);
}

export function moveExercise(list, index, dir) {
  const j = index + dir;
  if (j < 0 || j >= list.length) return list;
  const ex = list[index];
  if (ex.ssGroupId) {
    if (list[j].ssGroupId !== ex.ssGroupId) return list;
    const next = list.slice();
    const a = next[index];
    next[index] = next[j];
    next[j] = a;
    return next;
  }
  // Ungrouped ▲▼ skip a neighbouring run rather than splitting it.
  if (list[j].ssGroupId) {
    const item = list[index];
    const rest = list.filter((_, i) => i !== index);
    const mem = membersOf(list, list[j].ssGroupId);
    const at = dir < 0 ? rest.indexOf(mem[0]) : rest.indexOf(mem[mem.length - 1]) + 1;
    if (at < 0) return list;
    rest.splice(at, 0, item);
    return rest;
  }
  const next = list.slice();
  const a = next[index];
  next[index] = next[j];
  next[j] = a;
  return next;
}

/** Fresh ids so pasting a workout onto a plan day cannot collide with existing groups. */
export function remapGroupIds(list) {
  const map = Object.create(null);
  return list.map(e => {
    if (!e.ssGroupId) return e;
    if (!map[e.ssGroupId]) map[e.ssGroupId] = newGroupId();
    return { ...e, ssGroupId: map[e.ssGroupId] };
  });
}

export function moveGroup(list, gid, dir) {
  const mem = membersOf(list, gid);
  if (!mem.length) return list;
  const rest = list.filter(x => x.ssGroupId !== gid);
  const firstIdx = list.indexOf(mem[0]);
  const lastIdx = list.indexOf(mem[mem.length - 1]);
  let at;
  if (dir < 0) {
    if (firstIdx === 0) return list;
    const nb = list[firstIdx - 1];
    at = nb.ssGroupId ? rest.indexOf(membersOf(list, nb.ssGroupId)[0]) : rest.indexOf(nb);
  } else {
    if (lastIdx === list.length - 1) return list;
    const nb = list[lastIdx + 1];
    at = nb.ssGroupId
      ? rest.indexOf(membersOf(list, nb.ssGroupId)[membersOf(list, nb.ssGroupId).length - 1]) + 1
      : rest.indexOf(nb) + 1;
  }
  if (at < 0) return list;
  rest.splice(at, 0, ...mem);
  return rest;
}

export function removeExercise(list, index) {
  if (index < 0 || index >= list.length) return list;
  return normalizeSupersetGroups(list.filter((_, i) => i !== index));
}
