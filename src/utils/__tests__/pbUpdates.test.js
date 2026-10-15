import { describe, expect, it } from 'vitest';
import { calcExercisePBs } from '../xp';
import { newPbsBetweenLogs } from '../pbUpdates';

const EX = {
  bench: { id: 'bench', name: 'Bench', category: 'strength', pbType: 'Strength 1RM' },
};

const bench225 = { exId: 'bench', sets: 1, reps: 1, weightLbs: 225 };
const bench185 = { exId: 'bench', sets: 1, reps: 1, weightLbs: 185 };

describe('newPbsBetweenLogs', () => {
  it('does not announce the first-ever log of an exercise, but that log is still stored as the PB', () => {
    expect(newPbsBetweenLogs([], [bench225], EX)).toEqual({});
    expect(calcExercisePBs([bench225], EX).bench).toEqual({ type: 'Strength 1RM', value: 225 });
  });

  it('emits a new PB when a second, better log beats the earlier result', () => {
    const updates = newPbsBetweenLogs([bench185], [bench225, bench185], EX);
    expect(updates.bench).toEqual({ type: 'Strength 1RM', value: 225 });
  });

  it('emits no new-PB toast or is_pb event when the workout is not a new best, even if the stored map is stale', () => {
    const oldLog = [bench225];
    const newLog = [bench185, bench225];
    const staleStoredMap = {};
    const storedWouldAnnounce = !staleStoredMap.bench;
    expect(storedWouldAnnounce).toBe(true);
    expect(newPbsBetweenLogs(oldLog, newLog, EX)).toEqual({});
  });

  it('does not announce an already-logged best as new just because the stored map is empty', () => {
    const log = [bench225];
    expect(newPbsBetweenLogs(log, log, EX)).toEqual({});
  });
});
