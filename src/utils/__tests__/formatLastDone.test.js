import { describe, expect, it } from 'vitest';
import { formatLastDone } from '../time';

describe('formatLastDone', () => {
  const today = '2026-10-08';

  it('handles empty and relative days', () => {
    expect(formatLastDone(null, today)).toBe('Not logged yet');
    expect(formatLastDone('2026-10-08', today)).toBe('Last done today');
    expect(formatLastDone('2026-10-07', today)).toBe('Last done yesterday');
    expect(formatLastDone('2026-10-05', today)).toBe('Last done 3 days ago');
    expect(formatLastDone('2026-10-02', today)).toBe('Last done 6 days ago');
  });

  it('falls back to a short date after a week', () => {
    expect(formatLastDone('2026-10-01', today)).toMatch(/^Last done Oct 1$/);
    expect(formatLastDone('2025-12-25', today)).toMatch(/^Last done Dec 25, 2025$/);
  });
});
