import { describe, expect, it } from 'vitest';
import { calcExercisePBs } from '../../utils/xp';
import { buildPreviewLog, PREVIEW_EXERCISE_PBS, PREVIEW_SEED_EX_LOOKUP } from '../previewSeed';

describe('preview seed PB backups', () => {
  it('recomputes the seeded bench / squat / deadlift / run PBs from the log', () => {
    const pbs = calcExercisePBs(buildPreviewLog(), PREVIEW_SEED_EX_LOOKUP);
    expect(pbs.bench).toEqual(PREVIEW_EXERCISE_PBS.bench);
    expect(pbs.squat).toEqual(PREVIEW_EXERCISE_PBS.squat);
    expect(pbs.deadlift).toEqual(PREVIEW_EXERCISE_PBS.deadlift);
    expect(pbs.run.type).toBe('Cardio Pace');
    expect(pbs.run.value).toBeCloseTo(PREVIEW_EXERCISE_PBS.run.value, 2);
  });
});
