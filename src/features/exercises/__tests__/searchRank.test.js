import { describe, it, expect } from 'vitest';
import { searchMatchKind, rankSearch, matchesSearchExpanded } from '../searchRank';

const ex = (over = {}) => ({
  id: over.id || over.name || 'x',
  name: 'Barbell Bench Press',
  muscleGroup: 'chest',
  equipment: 'barbell',
  ...over,
});

describe('searchMatchKind', () => {
  it('ranks exact, then prefix, then word-prefix, then substring', () => {
    expect(searchMatchKind(ex({ name: 'Bench' }), 'bench')).toBe(0);
    expect(searchMatchKind(ex({ name: 'Bench Press' }), 'bench')).toBe(1);
    expect(searchMatchKind(ex({ name: 'Barbell Bench Press' }), 'bench')).toBe(2);
    expect(searchMatchKind(ex({ name: 'Declinebench' }), 'bench')).toBe(3);
  });

  it('also matches muscle and equipment as a weaker hit', () => {
    expect(searchMatchKind(ex({ name: 'Push-up', muscleGroup: 'chest' }), 'chest')).toBe(4);
    expect(searchMatchKind(ex({ name: 'Push-up', equipment: 'barbell' }), 'barbell')).toBe(4);
    expect(matchesSearchExpanded(ex({ name: 'Row', muscleGroup: 'back' }), 'squat')).toBe(false);
  });
});

describe('rankSearch', () => {
  it('orders by match quality, then favourite, then recent', () => {
    const exact = ex({ id: 'exact', name: 'Bench' });
    const prefix = ex({ id: 'prefix', name: 'Bench Press' });
    const word = ex({ id: 'word', name: 'Barbell Bench Press' });
    const sub = ex({ id: 'sub', name: 'Inclinebench' });
    const favWord = ex({ id: 'fav', name: 'Close Grip Bench Press' });
    const ranked = rankSearch(
      [sub, word, exact, prefix, favWord],
      'bench',
      new Set(['fav']),
      new Set(),
    );
    expect(ranked.map(e => e.id)).toEqual(['exact', 'prefix', 'fav', 'word', 'sub']);
  });
});
