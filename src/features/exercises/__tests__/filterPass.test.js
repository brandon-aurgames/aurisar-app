import { describe, it, expect } from 'vitest';
import { filterAndCount } from '../filterPass';
import { facetCounts, matchesAll, muscleKeys, typeKeys, equipKeys, NO_FACET } from '../matchesFacets';

const S = (...v) => new Set(v);
const ex = (over = {}) => ({
  id: over.id || `${over.name || 'x'}-${over.muscleGroup || 'chest'}`,
  name: over.name || 'Move',
  muscleGroup: 'chest',
  category: 'strength',
  exerciseType: 'strength',
  equipment: 'barbell',
  ...over,
});

const catalog = [
  ex({ id: 'bench', name: 'Barbell Bench Press', muscleGroup: 'chest', equipment: 'barbell' }),
  ex({ id: 'db-bench', name: 'Dumbbell Bench Press', muscleGroup: 'chest', equipment: 'dumbbell' }),
  ex({ id: 'row', name: 'Barbell Row', muscleGroup: 'back', equipment: 'barbell' }),
  ex({ id: 'run', name: 'Easy Run', muscleGroup: 'cardio', category: 'cardio', exerciseType: 'cardio', equipment: 'bodyweight' }),
];

describe('filterAndCount', () => {
  it('builds the list and ignore-self facet counts in one pass', () => {
    const { list, muscleCounts, typeCounts, equipCounts } = filterAndCount(catalog, {
      query: '',
      muscleSet: S('chest'),
      typeSet: S(),
      equipSet: S(),
    });
    expect(list.map(e => e.id).sort()).toEqual(['bench', 'db-bench']);

    const muscleLegacy = facetCounts(catalog, muscleKeys, e => matchesAll(e, '', NO_FACET, S(), S()));
    const typeLegacy = facetCounts(catalog, typeKeys, e => matchesAll(e, '', S('chest'), NO_FACET, S()));
    const equipLegacy = facetCounts(catalog, equipKeys, e => matchesAll(e, '', S('chest'), S(), NO_FACET));
    expect([...muscleCounts.entries()].sort()).toEqual([...muscleLegacy.entries()].sort());
    expect([...typeCounts.entries()].sort()).toEqual([...typeLegacy.entries()].sort());
    expect([...equipCounts.entries()].sort()).toEqual([...equipLegacy.entries()].sort());
  });

  it('does not let a facet constrain its own counts', () => {
    const { muscleCounts } = filterAndCount(catalog, {
      muscleSet: S('chest'),
      typeSet: S(),
      equipSet: S(),
    });
    expect(muscleCounts.get('chest')).toBe(2);
    expect(muscleCounts.get('back')).toBe(1);
  });

  it('skips rest_day', () => {
    const { list } = filterAndCount([ex({ id: 'rest_day', name: 'Rest' })], {});
    expect(list).toEqual([]);
  });
});
