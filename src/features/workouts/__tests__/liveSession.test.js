import { describe, expect, it } from 'vitest';
import { liveStartAction } from '../liveSession';

describe('liveStartAction', () => {
  const wo = { id: 'push', name: 'Push' };

  it('starts when nothing is live', () => {
    expect(liveStartAction(null, wo)).toBe('start');
  });

  it('resumes the in-progress workout instead of replacing it', () => {
    expect(liveStartAction({ workoutId: 'push', startedAt: '2026-10-08T10:00:00.000Z' }, wo)).toBe('resume');
  });

  it('asks to replace when a different workout is live', () => {
    expect(liveStartAction({ workoutId: 'pull' }, wo)).toBe('replace');
  });
});
