import { describe, it, expect } from 'vitest';
import { lastLoggedLabel } from '../ExerciseRow';

describe('lastLoggedLabel', () => {
  it('formats today / yesterday / N days and hides unknown', () => {
    expect(lastLoggedLabel(0)).toBe('Last logged today');
    expect(lastLoggedLabel(1)).toBe('Last logged yesterday');
    expect(lastLoggedLabel(5)).toBe('Last logged 5 days ago');
    expect(lastLoggedLabel(null)).toBeNull();
    expect(lastLoggedLabel(undefined)).toBeNull();
  });
});
