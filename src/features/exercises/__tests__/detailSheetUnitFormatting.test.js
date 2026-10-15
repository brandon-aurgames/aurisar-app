import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const src = readFileSync(ROOT + 'src/features/exercises/ExerciseDetailSheet.jsx', 'utf8');
const formatSrc = readFileSync(ROOT + 'src/utils/formatPbValue.js', 'utf8');

describe('ExerciseDetailSheet respects profile.units', () => {
  it('gated PB chrome renders through formatPbValue, which uses displayPace for pace', () => {
    expect(src).toContain('formatPbValue(pb, profile.units)');
    expect(formatSrc).toContain('displayPace(val, units)');
    expect(formatSrc).not.toMatch(/min\/mi`;/);
  });

  it('does not offer Configure or Stage, and hides the empty History forge copy', () => {
    expect(src).not.toMatch(/Configure/);
    expect(src).not.toMatch(/Stage for later/);
    expect(src).toContain('No logs yet.');
    expect(src).toMatch(/ex-lib-primary-btn/);
  });

  it('the last-session line renders weight through displayWt, not a hardcoded "lbs" literal', () => {
    expect(src).toContain('displayWt(lastRow.weightLbs, profile.units)');
    expect(src).not.toMatch(/\$\{Math\.abs\(trendDelta\)\}\s*lbs/);
  });
});
