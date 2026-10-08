// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import LiveWorkoutBanner from '../LiveWorkoutBanner';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const liveWorkout = {
  workoutId: 'push',
  name: 'Phone Push',
  icon: '💪',
  exercises: [{ exId: 'a', name: 'Bench', sets: 3, reps: 10, done: true }],
};

it('opens the tracker when openSignal increments without rebuilding the session', () => {
  const { rerender } = render(
    <LiveWorkoutBanner liveWorkout={liveWorkout} openSignal={0} allExercises={[]} />,
    { container: document.getElementById('root') },
  );
  expect(screen.queryByRole('dialog', { name: 'Active workout tracker' })).toBeNull();
  rerender(<LiveWorkoutBanner liveWorkout={liveWorkout} openSignal={1} allExercises={[]} />);
  expect(screen.getByRole('dialog', { name: 'Active workout tracker' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Mark Bench not done' })).toBeTruthy();
});
