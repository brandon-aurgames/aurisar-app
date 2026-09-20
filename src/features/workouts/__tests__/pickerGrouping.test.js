import { describe, it, expect } from 'vitest';
import { groupByMuscle, buildGroupedItems, muscleKey } from '../pickerGrouping';

const ex = (id, muscleGroup) => ({ id, name: id, muscleGroup });

// A few exercises out of facet order, one with an unknown muscle and one with
// no muscle at all.
const CATALOG = [
  ex('squat', 'legs'),
  ex('bench', 'chest'),
  ex('lunge', 'legs'),
  ex('curl', 'bicep'),
  ex('press', 'chest'),
  ex('mystery', 'tail'),   // not in the facet vocabulary
  ex('breath', ''),        // no muscle group
];

const expandAll = () => true;
const collapseAll = () => false;

describe('muscleKey', () => {
  it('normalises blank and mixed-case groups onto the same section key', () => {
    expect(muscleKey({ muscleGroup: 'Chest' })).toBe('chest');
    expect(muscleKey({ muscleGroup: '  ' })).toBe('other');
    expect(muscleKey({})).toBe('other');
  });
});

describe('groupByMuscle', () => {
  it('buckets by muscle in facet order, unknown/empty last', () => {
    const groups = groupByMuscle(CATALOG);
    // Facet order first (chest < bicep < legs); the two out-of-vocabulary
    // sections tie at the end and break by label ('Other' < 'Tail').
    expect(groups.map(g => g.muscle)).toEqual(['chest', 'bicep', 'legs', 'other', 'tail']);
    expect(groups.find(g => g.muscle === 'chest').exercises.map(e => e.id)).toEqual(['bench', 'press']);
    expect(groups.find(g => g.muscle === 'legs').exercises).toHaveLength(2);
    expect(groups.find(g => g.muscle === 'other').exercises.map(e => e.id)).toEqual(['breath']);
  });

  it('labels muscles via the shared muscleLabel', () => {
    const legs = groupByMuscle(CATALOG).find(g => g.muscle === 'legs');
    expect(legs.label).toBe('Legs');
  });
});

describe('buildGroupedItems', () => {
  it('emits header + rows for expanded sections', () => {
    const { items } = buildGroupedItems(CATALOG, expandAll);
    // 5 groups → 5 headers + 7 exercise rows = 12 items.
    expect(items.filter(i => i.kind === 'header')).toHaveLength(5);
    expect(items.filter(i => i.kind === 'row')).toHaveLength(7);
    const chestHeader = items.find(i => i.kind === 'header' && i.muscle === 'chest');
    expect(chestHeader).toMatchObject({ label: 'Chest', count: 2, expanded: true });
  });

  it('a collapsed section costs a single header row, not its members', () => {
    const { items } = buildGroupedItems(CATALOG, collapseAll);
    expect(items.every(i => i.kind === 'header')).toBe(true);
    expect(items).toHaveLength(5);
    expect(items.every(i => i.expanded === false)).toBe(true);
  });

  it('expands only the sections isExpanded approves', () => {
    const onlyLegs = muscle => muscle === 'legs';
    const { items } = buildGroupedItems(CATALOG, onlyLegs);
    const rows = items.filter(i => i.kind === 'row');
    expect(rows.map(r => r.ex.id).sort()).toEqual(['lunge', 'squat']);
  });

  it('passes the section count so a lone section can auto-expand', () => {
    const single = [ex('squat', 'legs'), ex('lunge', 'legs')];
    const autoWhenAlone = (_muscle, groupCount) => groupCount === 1;
    const { items } = buildGroupedItems(single, autoWhenAlone);
    expect(items.filter(i => i.kind === 'row')).toHaveLength(2);
  });
});
