// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import LiveWorkoutBanner from '../LiveWorkoutBanner';
import { liveAddDefaultsFromLog } from '../../features/workouts/liveAddDefaults';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('prefills live-add defaults from the newest log row', () => {
  expect(liveAddDefaultsFromLog(
    [{ exId: 'bench', sets: 5, reps: 3, weightLbs: 225 }],
    'bench',
  )).toEqual({ sets: '5', reps: '3', weightLbs: '225' });
  expect(liveAddDefaultsFromLog([], 'bench')).toEqual({ sets: '3', reps: '10', weightLbs: '' });
});

it('adds a live exercise using last-log sets, reps, and weight', () => {
  const onAddExercise = vi.fn();
  const allExercises = [
    { id: 'bench', name: 'Bench Press', category: 'strength', muscleGroup: 'chest', equipment: 'barbell' },
  ];
  render(
    <LiveWorkoutBanner
      liveWorkout={{
        workoutId: 'push',
        name: 'Push',
        icon: '💪',
        exercises: [{ exId: 'row', name: 'Row', sets: 3, reps: 10, done: false }],
      }}
      openSignal={0}
      allExercises={allExercises}
      units="imperial"
      log={[{ exId: 'bench', sets: 5, reps: 3, weightLbs: 225 }]}
      onAddExercise={onAddExercise}
      onToggleExercise={() => {}}
      onFinish={() => {}}
      onDiscard={() => {}}
      onUpdateExercise={() => {}}
      onRemoveExercise={() => {}}
    />,
    { container: document.getElementById('root') },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open active workout tracker' }));
  fireEvent.click(screen.getByRole('button', { name: '+ Add Exercise' }));
  fireEvent.click(screen.getByRole('button', { name: /Bench Press/ }));
  fireEvent.click(screen.getByRole('button', { name: '＋ Add 1' }));
  expect(onAddExercise).toHaveBeenCalledWith([
    expect.objectContaining({ exId: 'bench', sets: '5', reps: '3', weightLbs: '225' }),
  ]);
});
