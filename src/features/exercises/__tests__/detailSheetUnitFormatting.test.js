import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * PR #294 review: ExerciseDetailSheet hardcoded units in two places even
 * though metric users see every other figure (Last session, PB weight)
 * converted via displayWt/displayPace —
 *   - the Your PB chip now goes through formatPbValue (displayPace for pace)
 *   - the History "Trend" chip always appended "lbs" to a raw weightLbs delta
 * Source guard: both are deep in a large render function, not worth a full
 * jsdom mount for this file's dependency surface.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const src = readFileSync(ROOT + 'src/features/exercises/ExerciseDetailSheet.jsx', 'utf8');
const formatSrc = readFileSync(ROOT + 'src/utils/formatPbValue.js', 'utf8');

describe('ExerciseDetailSheet respects profile.units', () => {
  it('Your PB chip renders through formatPbValue, which uses displayPace for pace', () => {
    expect(src).toContain('formatPbValue(pb, profile.units)');
    expect(formatSrc).toContain('displayPace(val, units)');
    expect(formatSrc).not.toMatch(/min\/mi`;/);
  });

  it('does not offer Configure or Stage, and hides the empty History forge copy', () => {
    expect(src).not.toMatch(/Configure/);
    expect(src).not.toMatch(/Stage for later/);
    expect(src).toContain('No logs yet.');
    expect(src).toMatch(/className=\{["']btn btn-gold btn-sm["']\}/);
  });

  it('the History Trend chip renders its delta through displayWt, not a hardcoded "lbs" literal', () => {
    const idx = src.indexOf('"Trend"');
    const chip = src.slice(idx, idx + 400);
    expect(chip).toContain('displayWt(Math.abs(trendDelta), profile.units)');
    expect(chip).not.toMatch(/\$\{Math\.abs\(trendDelta\)\}\s*lbs/);
  });
});
