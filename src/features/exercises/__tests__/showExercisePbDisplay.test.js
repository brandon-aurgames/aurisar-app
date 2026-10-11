import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SHOW_EXERCISE_PB_DISPLAY } from '../showExercisePbDisplay';

/**
 * Brandon asked to drop on-exercise PB badges for now (they crowd the
 * rows). Tracking stays; only the chrome is gated. These guards keep the
 * kill switch off and make sure every former render site still consults it
 * so flipping the flag is the only restore step.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = p => readFileSync(ROOT + p, 'utf8');

const DISPLAY_SITES = [
  'src/features/exercises/ExerciseRow.jsx',
  'src/features/exercises/MyWorkoutsSubTab.jsx',
  'src/features/exercises/ExerciseDetailSheet.jsx',
  'src/features/exercises/QuickLogModal.jsx',
  'src/features/workouts/WorkoutsTab.jsx',
  'src/components/PlansTabContainer.jsx',
  'src/components/PlanWizard.jsx',
];

describe('on-exercise PB display', () => {
  it('is hidden by the kill switch', () => {
    expect(SHOW_EXERCISE_PB_DISPLAY).toBe(false);
  });

  it('reads VITE_SHOW_EXERCISE_PB so the on-state is checkable without a source edit', () => {
    const src = read('src/features/exercises/showExercisePbDisplay.js');
    expect(src).toMatch(/import\.meta\.env\.VITE_SHOW_EXERCISE_PB\s*===\s*['"]true['"]/);
  });

  it('gates every former exercise-row / list / detail render site', () => {
    for (const file of DISPLAY_SITES) {
      const src = read(file);
      expect(src, `${file} must import the kill switch`).toContain('SHOW_EXERCISE_PB_DISPLAY');
      expect(src, `${file} must AND the flag at the render/compute site`).toMatch(/SHOW_EXERCISE_PB_DISPLAY\s*&&/);
    }
  });

  it('does not render the ExerciseRow trophy unless the flag and showPB are both on', () => {
    const src = read('src/features/exercises/ExerciseRow.jsx');
    expect(src).toMatch(/showPbBadge\s*=\s*SHOW_EXERCISE_PB_DISPLAY\s*&&\s*showPB/);
    expect(src).toMatch(/\{showPbBadge && <span[^>]*aria-hidden="true"/);
  });
});
