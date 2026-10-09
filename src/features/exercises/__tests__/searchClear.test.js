import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = p => readFileSync(ROOT + p, 'utf8');

describe('pending search debounce is cancelled on clear', () => {
  it('library clear and clear-all drop the pending callback', () => {
    const src = read('src/features/exercises/ExerciseLibraryTab.jsx');
    expect(src).toMatch(/debouncedSetLibSearch\.cancel/);
    expect(src.match(/debouncedSetLibSearch\.cancel/g).length).toBeGreaterThanOrEqual(2);
  });

  it('gives TechSearch an accessible label in every exercise-search context', () => {
    expect(read('src/features/exercises/ExerciseLibraryTab.jsx')).toContain('label={"Search exercises"}');
    expect(read('src/features/workouts/WorkoutExercisePicker.jsx')).toContain('label={"Search exercises"}');
    expect(read('src/features/exercises/MyWorkoutsSubTab.jsx')).toContain('label={"Search my exercises"}');
    expect(read('src/features/exercises/ExerciseEditorModal.jsx')).toContain('label={"Search catalog to start from"}');
  });

  it('add-to-existing from the tray does not clear until a workout is chosen', () => {
    const app = read('src/App.jsx');
    const start = app.indexOf('onAddToExisting={() =>');
    const body = app.slice(start, start + 280);
    expect(body).toContain('fromCart: true');
    expect(body).not.toMatch(/clearCart\(\)/);
    expect(app).toMatch(/if \(addToWorkoutPicker\.fromCart\) clearCart\(\)/);
  });
});
