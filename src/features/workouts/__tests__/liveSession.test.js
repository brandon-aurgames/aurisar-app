import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { liveStartAction } from '../liveSession';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

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

describe('App startLiveWorkout resume path', () => {
  it('resumes the same workout without rebuilding the session', () => {
    const src = readFileSync(ROOT + 'src/App.jsx', 'utf8');
    const start = src.indexOf('function startLiveWorkout(wo)');
    const body = src.slice(start, src.indexOf('function confirmReplaceLiveWorkout()'));
    expect(body).toContain('liveStartAction(liveWorkout, wo)');
    const resume = body.slice(body.indexOf('action === "resume"'), body.indexOf('action === "replace"'));
    expect(resume).toContain('setLiveOpenSignal');
    expect(resume).not.toContain('setLiveWorkout');
    expect(resume).not.toContain('_buildLiveExercises');
  });
});
