import { describe, it, expect } from 'vitest';
import { resolveMatched, countMeta } from '../matchedFavorites';

const catalog = {
  a: { id: 'a', name: 'Bench Press', muscleGroup: 'chest' },
  b: { id: 'b', name: 'Squat', muscleGroup: 'legs' },
  c: { id: 'c', name: 'Barbell Row', muscleGroup: 'back' },
};

describe('resolveMatched', () => {
  it('drops stale ids so pagination cannot expand into ghosts', () => {
    const { resolved, matched } = resolveMatched(
      ['a', 'gone', 'b', 'also-gone'],
      catalog,
      '',
    );
    expect(resolved.map(e => e.id)).toEqual(['a', 'b']);
    expect(matched.map(e => e.id)).toEqual(['a', 'b']);
  });

  it('returns no hits with a scoped search', () => {
    const { resolved, matched } = resolveMatched(['a', 'b', 'c'], catalog, 'zzz');
    expect(resolved).toHaveLength(3);
    expect(matched).toHaveLength(0);
    expect(countMeta(matched.length, resolved.length, 'zzz')).toBe('0 of 3');
  });

  it('pages from resolved matches, not the raw id list, when there are more than 20', () => {
    const ids = [];
    const big = {};
    for (let i = 0; i < 25; i++) {
      const id = `f${i}`;
      ids.push(id);
      big[id] = { id, name: `Fav ${i}`, muscleGroup: 'chest' };
    }
    ids.push('stale-1', 'stale-2');
    const { resolved, matched } = resolveMatched(ids, big, '');
    expect(resolved).toHaveLength(25);
    expect(matched).toHaveLength(25);
    expect(ids.length).toBe(27);
    expect(matched.slice(0, 20)).toHaveLength(20);
    expect(matched.length > 20).toBe(true);
  });
});

describe('countMeta', () => {
  it('shows matched/total under search and the plain total otherwise', () => {
    expect(countMeta(2, 5, 'bench')).toBe('2 of 5');
    expect(countMeta(5, 5, '')).toBe('5');
    expect(countMeta(0, 0, '')).toBeNull();
  });
});
