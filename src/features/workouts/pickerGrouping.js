import { MUSCLE_OPTS, muscleLabel } from '../exercises/exerciseFilterOptions';

/**
 * Muscle grouping for the workout-builder exercise picker.
 *
 * The picker renders one flat, virtualized react-window list. To show
 * collapsible muscle sections without giving up virtualization, we flatten the
 * filtered catalog into a single array of items — each item is either a section
 * header or an exercise row — and only emit a section's rows when it is
 * expanded. A collapsed section therefore costs exactly one header row, never
 * its (up to ~370) members.
 */

// Facet display order; anything the catalog carries that isn't in the facet
// vocabulary (or has no muscleGroup) sorts to the end.
export const MUSCLE_ORDER = new Map(MUSCLE_OPTS.map((m, i) => [m, i]));

/** Canonical section key for an exercise — shared by grouping and "keep open". */
export function muscleKey(ex) {
  return (ex?.muscleGroup || '').toLowerCase().trim() || 'other';
}

/** Bucket the filtered exercises by muscle, in facet order. */
export function groupByMuscle(filtered) {
  const byMuscle = new Map();
  for (const ex of filtered) {
    const m = muscleKey(ex);
    let g = byMuscle.get(m);
    if (!g) { g = []; byMuscle.set(m, g); }
    g.push(ex);
  }
  return [...byMuscle.entries()]
    .map(([muscle, exercises]) => ({ muscle, label: muscleLabel(muscle), exercises }))
    .sort((a, b) => {
      const ai = MUSCLE_ORDER.has(a.muscle) ? MUSCLE_ORDER.get(a.muscle) : 999;
      const bi = MUSCLE_ORDER.has(b.muscle) ? MUSCLE_ORDER.get(b.muscle) : 999;
      return ai - bi || a.label.localeCompare(b.label);
    });
}

/**
 * Flatten into the virtualized item list.
 * `isExpanded(muscle, groupCount)` decides whether a section's rows are emitted.
 */
export function buildGroupedItems(filtered, isExpanded) {
  const groups = groupByMuscle(filtered);
  const items = [];
  for (const g of groups) {
    const expanded = isExpanded(g.muscle, groups.length);
    items.push({ kind: 'header', muscle: g.muscle, label: g.label, count: g.exercises.length, expanded });
    if (expanded) for (const ex of g.exercises) items.push({ kind: 'row', ex });
  }
  return { groups, items };
}
