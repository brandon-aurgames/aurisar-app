import { describe, it, expect } from 'vitest';
import { calcExXP } from '../../../utils/xp';
import {
  detailWorkoutEntry,
  offersAddToWorkout,
  detailLogArgs,
  detailPlanEntry,
} from '../detailActions';

const custom = {
  id: 'custom-row',
  name: 'My Row',
  icon: '💪',
  category: 'strength',
  defaultSets: 4,
  defaultReps: 8,
  defaultWeightLbs: 135,
  defaultWeightPct: 90,
  defaultDistanceMi: null,
  defaultHrZone: null,
  defaultDurationMin: 12,
};

const timed = {
  id: 'run',
  name: 'Running',
  category: 'cardio',
  defaultSets: null,
  defaultReps: 30,
  defaultDistanceMi: 3.1,
  defaultHrZone: 2,
};

describe('detailWorkoutEntry', () => {
  it('copies custom defaults including intensity, duration, weight', () => {
    expect(detailWorkoutEntry(custom)).toEqual({
      exId: 'custom-row',
      sets: 4,
      reps: 8,
      weightLbs: 135,
      durationMin: 12,
      weightPct: 90,
      distanceMi: null,
      hrZone: null,
    });
  });

  it('uses 3×10 and weightPct 100 when defaults are missing (intentional)', () => {
    expect(detailWorkoutEntry({ id: 'bench', name: 'Bench Press' })).toEqual({
      exId: 'bench',
      sets: 3,
      reps: 10,
      weightLbs: null,
      durationMin: null,
      weightPct: 100,
      distanceMi: null,
      hrZone: null,
    });
  });

  it('passes timed/no-sets defaults through the same shape', () => {
    expect(detailWorkoutEntry(timed)).toMatchObject({
      exId: 'run',
      sets: 3,
      reps: 30,
      weightPct: 100,
      distanceMi: 3.1,
      hrZone: 2,
    });
  });
});

describe('detail Log / Plan / rest day', () => {
  it('Log hands the exercise to quick-log as a detail origin', () => {
    expect(detailLogArgs(custom)).toEqual({ origin: { type: 'detail', ex: custom } });
  });

  it('Add to Plan uses planEntry sets/reps/weight', () => {
    const entry = detailPlanEntry(custom, 'warrior', { 'custom-row': custom });
    expect(entry).toMatchObject({
      exId: 'custom-row',
      exercise: 'My Row',
      sets: 4,
      reps: 8,
      weightLbs: 135,
    });
    expect(entry.xp).toBe(calcExXP('custom-row', 4, 8, 'warrior', { 'custom-row': custom }));
  });

  it('does not offer Add to Workout on rest day', () => {
    expect(offersAddToWorkout({ id: 'rest_day' })).toBe(false);
    expect(offersAddToWorkout(custom)).toBe(true);
  });
});
