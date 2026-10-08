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
  HTMLElement.prototype.scrollIntoView = vi.fn();
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
it('lists Reusable and Scheduled tabs and hides One-Off', () => {
  setup();
  expect(screen.getByRole('button', { name: /^Reusable$/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Scheduled$/i })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /One-Off/i })).toBeNull();
  expect(screen.getAllByRole('button', { name: /New Workout/i }).length).toBeGreaterThan(0);
});
it('shows Resume on a live workout card and keeps calling startLiveWorkout', () => {
  const workout = { id: 'push', name: 'Phone Push', icon: '💪', exercises, oneOff: false };
  const startLiveWorkout = vi.fn();
  setup({
    profile: { workouts: [workout], workoutLabels: [], chosenClass: null, units: 'imperial' },
    liveWorkout: { workoutId: 'push', name: 'Phone Push', exercises: [{ exId: 'a', done: true }] },
    startLiveWorkout,
  });
  const resume = screen.getByRole('button', { name: /^Resume$/i });
  expect(resume.className).toMatch(/\bon\b/);
  expect(document.querySelector('.workout-card.live')).toBeTruthy();
  fireEvent.click(resume);
  expect(startLiveWorkout).toHaveBeenCalledTimes(1);
  expect(startLiveWorkout.mock.calls[0][0].id).toBe('push');
});
it('shows a friendly last-done line instead of a raw date', () => {
  const workout = { id: 'push', name: 'Phone Push', icon: '💪', exercises, oneOff: false };
  setup({
    profile: {
      workouts: [workout],
      workoutLabels: [],
      chosenClass: null,
      units: 'imperial',
      log: [{ sourceWorkoutId: 'push', dateKey: '2020-01-15' }],
    },
  });
  expect(screen.getByText(/Last done Jan 15, 2020/)).toBeTruthy();
  expect(screen.queryByText(/2020-01-15/)).toBeNull();
});
it('gives the Scheduled empty state a path back to Reusable', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: /^Scheduled$/i }));
  fireEvent.click(screen.getByRole('button', { name: /Browse reusable workouts/i }));
  expect(screen.getAllByRole('button', { name: /New Workout/i }).length).toBeGreaterThan(0);
});
it('labels recipe customize and edit-mode save-as-copy accurately', () => {
  const workout = { id: 'push', name: 'Phone Push', icon: '💪', exercises, oneOff: false };
  setup({ profile: { workouts: [workout], workoutLabels: [], chosenClass: null, units: 'imperial' } });
  fireEvent.click(screen.getByRole('button', { name: /Recipes/i }));
  expect(screen.getAllByRole('button', { name: /^Customize$/i }).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: /^Duplicate$/i })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '← Back' }));
  fireEvent.click(screen.getByText('Phone Push'));
  expect(screen.getByRole('button', { name: /^Duplicate$/i })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
  expect(screen.getByRole('button', { name: /Save as copy/i })).toBeTruthy();
});
it('uses Custom exercise instead of Forge Custom and keeps the count readable', () => {
  const { ref } = setup();
  act(() => ref.current.openBuilderWithExercises(exercises));
  expect(screen.queryByRole('button', { name: /Forge Custom/i })).toBeNull();
  expect(screen.getByRole('button', { name: /Custom exercise/i })).toBeTruthy();
  expect(screen.getByText(/3 exercises/)).toBeTruthy();
  expect(document.querySelector('.wb-ex-meta')).toBeTruthy();
});
it('scrolls to and focuses the name field when Save fails validation', () => {
  const { ref } = setup();
  act(() => ref.current.openBuilderWithExercises(exercises));
  fireEvent.click(screen.getByRole('button', { name: /Save Workout/i }));
  expect(screen.getByText('Name your workout first.')).toBeTruthy();
  expect(document.getElementById('wb-name')).toBe(document.activeElement);
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
});
it('keeps duration and calories when saving an edited scheduled one-off', () => {
  const workout = { id: 'oneoff', name: 'Morning Push', icon: 'X', oneOff: true, exercises, durationMin: 3723, activeCal: '300', totalCal: '420', labels: [] };
  const profile = { workouts: [workout], scheduledWorkouts: [{ sourceWorkoutId: 'oneoff', sourceWorkoutName: workout.name, scheduledDate: '2099-01-01', exId: 'a' }], workoutLabels: [] };
  const { props } = setup({ profile });
  fireEvent.click(screen.getByRole('button', { name: /^Scheduled$/i }));
  fireEvent.click(screen.getByText('Morning Push'));
  fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
  fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
  const updated = props.setProfile.mock.calls.at(-1)[0](profile);
  expect(updated.workouts[0]).toMatchObject({ id: 'oneoff', oneOff: true, durationMin: 3723, activeCal: '300', totalCal: '420' });
});
