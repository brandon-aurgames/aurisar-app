// @vitest-environment jsdom
import React, { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WorkoutsTabContainer from '../WorkoutsTabContainer';

const dnd = vi.hoisted(() => ({ current: null }));
vi.mock('../useBuilderPointerDnd', () => ({ useBuilderPointerDnd: props => { dnd.current = props; } }));
vi.mock('../detailsFire', () => ({ createDetailsFire: () => ({ start() {}, stop() {}, destroy() {} }) }));
const exercises = ['a', 'b', 'c'].map(exId => ({ exId, sets: 3, reps: 10 }));
const allExById = Object.fromEntries(exercises.map(ex => [ex.exId, { id: ex.exId, name: `Exercise ${ex.exId}`, category: 'strength', muscleGroup: 'chest' }]));
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  document.body.innerHTML = '<div id="root" class="hud"></div>';
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(overrides = {}) {
  const ref = createRef();
  const props = { profile: { workouts: [], workoutLabels: [], chosenClass: null, units: 'imperial' }, allExById, allExercises: Object.values(allExById), setProfile: vi.fn(), showToast: vi.fn(), ...overrides };
  const view = render(<WorkoutsTabContainer {...props} ref={ref} />, { container: document.getElementById('root') });
  return { ...view, ref, props };
}
it('hides the portalled Details trigger on another tab and preserves the builder draft', () => {
  const { ref, props, rerender } = setup();
  act(() => ref.current.openBuilderWithExercises(exercises));
  fireEvent.change(screen.getByPlaceholderText('e.g. Morning Push Day…'), { target: { value: 'Draft to keep' } });
  expect(screen.getByRole('button', { name: 'Open workout details' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open workout details' }));
  expect(screen.getByRole('dialog', { name: 'Workout details' })).toBeTruthy();
  rerender(<WorkoutsTabContainer {...props} ref={ref} isActive={false} />);
  expect(screen.queryByRole('button', { name: 'Open workout details' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.style.overflow).not.toBe('hidden');
  expect(dnd.current.enabled).toBe(false);
  rerender(<WorkoutsTabContainer {...props} ref={ref} isActive />);
  expect(screen.getByPlaceholderText('e.g. Morning Push Day…').value).toBe('Draft to keep');
  expect(screen.getByRole('button', { name: 'Open workout details' })).toBeTruthy();
});
it('clears positional superset selections when a drag merge reorders the exercises', () => {
  const { ref, container } = setup();
  act(() => ref.current.openBuilderWithExercises(exercises));
  fireEvent.click(container.querySelector('[title="Select for superset"]'));
  expect(screen.getByText('Select 1 more to superset')).toBeTruthy();
  act(() => dnd.current.onMerge(0, 2));
  expect(screen.queryByText('Select 1 more to superset')).toBeNull();
  expect(container.querySelector('.ss-cb.on')).toBeNull();
  expect(dnd.current.exercises.map(ex => ex.exId)).toEqual(['b', 'c', 'a']);
});
it('keeps duration and calories when saving an edited scheduled one-off', () => {
  const workout = { id: 'oneoff', name: 'Scheduled', icon: 'X', oneOff: true, exercises, durationMin: 3723, activeCal: '300', totalCal: '420', labels: [] };
  const profile = { workouts: [workout], scheduledWorkouts: [{ sourceWorkoutId: 'oneoff', sourceWorkoutName: workout.name, scheduledDate: '2099-01-01', exId: 'a' }], workoutLabels: [] };
  const { props } = setup({ profile });
  fireEvent.click(screen.getByRole('button', { name: /One-Off/ }));
  fireEvent.click(screen.getByText('Scheduled'));
  fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
  fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
  const updated = props.setProfile.mock.calls.at(-1)[0](profile);
  expect(updated.workouts[0]).toMatchObject({ id: 'oneoff', oneOff: true, durationMin: 3723, activeCal: '300', totalCal: '420' });
});
