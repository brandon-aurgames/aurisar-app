// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import LiveWorkoutBanner from '../../../components/LiveWorkoutBanner';
import { liveStartAction } from '../liveSession';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const STARTED_AT = '2026-10-08T10:00:00.000Z';
const workout = { id: 'push', name: 'Phone Push', icon: '💪' };

function ResumeHarness() {
  const [live, setLive] = useState({
    workoutId: 'push',
    name: 'Phone Push',
    icon: '💪',
    startedAt: STARTED_AT,
    exercises: [{ exId: 'a', name: 'Bench', sets: 3, reps: 8, weightLbs: '185', done: true }],
  });
  const [openSignal, setOpenSignal] = useState(0);

  function startLiveWorkout(wo) {
    const action = liveStartAction(live, wo);
    if (action === 'resume') {
      setOpenSignal(n => n + 1);
      return;
    }
    setLive({
      workoutId: wo.id,
      name: wo.name,
      icon: wo.icon,
      startedAt: 'rebuilt',
      exercises: [{ exId: 'a', name: 'Bench', sets: 3, reps: 10, done: false }],
    });
    setOpenSignal(n => n + 1);
  }

  return (
    <>
      <button type="button" onClick={() => startLiveWorkout(workout)}>Resume</button>
      <div data-testid="started-at">{live.startedAt}</div>
      <LiveWorkoutBanner
        liveWorkout={live}
        openSignal={openSignal}
        allExercises={[]}
        onToggleExercise={() => {}}
        onFinish={() => {}}
        onDiscard={() => {}}
        onUpdateExercise={() => {}}
        onRemoveExercise={() => {}}
        onAddExercise={() => {}}
      />
    </>
  );
}

it('Resume reopens the tracker without rebuilding done flags, sets, or startedAt', () => {
  render(<ResumeHarness />, { container: document.getElementById('root') });
  fireEvent.click(screen.getByRole('button', { name: /^Resume$/i }));
  expect(screen.getByRole('dialog', { name: 'Active workout tracker' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Mark Bench not done' })).toBeTruthy();
  expect(screen.getByText('3×8 · 185 lbs')).toBeTruthy();
  expect(screen.getByTestId('started-at').textContent).toBe(STARTED_AT);
});
