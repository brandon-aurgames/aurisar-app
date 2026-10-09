// @vitest-environment jsdom
import React, { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WorkoutsTabContainer from '../WorkoutsTabContainer';

const dnd = vi.hoisted(() => ({ current: null }));
const pbDisplay = vi.hoisted(() => ({ on: false }));
vi.mock('../useBuilderPointerDnd', () => ({ useBuilderPointerDnd: props => { dnd.current = props; } }));
vi.mock('../detailsFire', () => ({ createDetailsFire: () => ({ start() {}, stop() {}, destroy() {} }) }));
vi.mock('../../exercises/showExercisePbDisplay', () => ({
  get SHOW_EXERCISE_PB_DISPLAY() { return pbDisplay.on; },
}));
const exercises = ['a', 'b', 'c'].map(exId => ({ exId, sets: 3, reps: 10 }));
const allExById = Object.fromEntries(exercises.map(ex => [ex.exId, { id: ex.exId, name: `Exercise ${ex.exId}`, category: 'strength', muscleGroup: 'chest' }]));
function stubMatchMedia(reduce = false) {
  vi.stubGlobal('matchMedia', (query = '') => ({
    matches: String(query).includes('prefers-reduced-motion') ? reduce : true,
    addEventListener() {},
    removeEventListener() {},
  }));
}
beforeEach(() => {
  pbDisplay.on = false;
  stubMatchMedia(false);
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
  const name = screen.getByRole('textbox', { name: /Name/ });
  expect(name).toBe(document.activeElement);
  expect(name.getAttribute('aria-invalid')).toBe('true');
  expect(name.getAttribute('aria-required')).toBe('true');
  expect(name.getAttribute('aria-describedby')).toBe('wb-name-error');
  expect(screen.getByRole('alert').id).toBe('wb-name-error');
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith(
    expect.objectContaining({ behavior: 'smooth' }),
  );
});
it('uses instant scroll to the name field when reduced motion is preferred', () => {
  stubMatchMedia(true);
  const { ref } = setup();
  act(() => ref.current.openBuilderWithExercises(exercises));
  fireEvent.click(screen.getByRole('button', { name: /Save Workout/i }));
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith(
    expect.objectContaining({ behavior: 'auto' }),
  );
});
it('warns on Cancel when only the name changed', () => {
  setup();
  fireEvent.click(screen.getAllByRole('button', { name: /New Workout/i })[0]);
  fireEvent.change(screen.getByRole('textbox', { name: /Name/ }), { target: { value: 'Name only' } });
  fireEvent.click(screen.getByRole('button', { name: /← Cancel/ }));
  expect(screen.getByRole('dialog', { name: /Discard draft/i })).toBeTruthy();
});
it('warns on Cancel when only session details changed', () => {
  setup();
  fireEvent.click(screen.getAllByRole('button', { name: /New Workout/i })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Open workout details' }));
  fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '00:45' } });
  fireEvent.submit(screen.getByLabelText('Duration').closest('form'));
  fireEvent.click(screen.getByRole('button', { name: /← Cancel/ }));
  expect(screen.getByRole('dialog', { name: /Discard draft/i })).toBeTruthy();
});
it('does not warn on Cancel for an unedited new or existing workout', () => {
  const workout = { id: 'push', name: 'Phone Push', icon: '💪', exercises, oneOff: false };
  setup({ profile: { workouts: [workout], workoutLabels: [], chosenClass: null, units: 'imperial' } });
  fireEvent.click(screen.getByText('Phone Push'));
  fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
  fireEvent.click(screen.getByRole('button', { name: /← Cancel/ }));
  expect(screen.queryByRole('dialog', { name: /Discard draft/i })).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: /New Workout/i })[0]);
  fireEvent.click(screen.getByRole('button', { name: /← Cancel/ }));
  expect(screen.queryByRole('dialog', { name: /Discard draft/i })).toBeNull();
});
function openPbBuilder(overrides = {}) {
  const run = { id: 'run', name: 'Running', category: 'cardio', muscleGroup: 'cardio' };
  const jog = { id: 'jog', name: 'Jog', category: 'cardio', muscleGroup: 'cardio' };
  const bench = { id: 'a', name: 'Exercise a', category: 'strength', muscleGroup: 'chest' };
  const catalog = { a: bench, run, jog };
  return setup({
    allExById: catalog,
    profile: {
      workouts: [],
      workoutLabels: [],
      chosenClass: null,
      units: 'metric',
      runningPB: 10,
      exercisePBs: {
        jog: { type: 'Cardio Pace', value: 10 },
        a: { weight: 185 },
      },
    },
    ...overrides,
  });
}

it('hides builder PB notation while the display flag is off', () => {
  const { ref } = openPbBuilder();
  act(() => ref.current.openBuilderWithExercises([{ exId: 'run', sets: 1, reps: 20 }, { exId: 'jog', sets: 1, reps: 20 }, { exId: 'a', sets: 3, reps: 10 }]));
  expect(screen.queryByText(/6\.21 min\/km/)).toBeNull();
  expect(screen.queryByText(/83\.9 kg/)).toBeNull();
  expect(screen.queryByText(/1RM/)).toBeNull();
});

it('renders pace PBs via displayPace and legacy weight PBs', () => {
  pbDisplay.on = true;
  const { ref, rerender, props } = openPbBuilder();
  act(() => ref.current.openBuilderWithExercises([{ exId: 'run', sets: 1, reps: 20 }, { exId: 'jog', sets: 1, reps: 20 }, { exId: 'a', sets: 3, reps: 10 }]));
  expect(screen.getAllByText(/6\.21 min\/km/).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText(/83\.9 kg/)).toBeTruthy();
  rerender(<WorkoutsTabContainer {...props} ref={ref} profile={{ ...props.profile, units: 'imperial' }} />);
  expect(screen.getAllByText(/10\.00 min\/mi/).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText(/185 lbs/)).toBeTruthy();
});
it('moves focus into the overflow menu and restores it on Escape', () => {
  const { ref } = setup();
  act(() => ref.current.openBuilderWithExercises(exercises));
  const trigger = screen.getByRole('button', { name: 'More actions for Exercise a' });
  fireEvent.click(trigger);
  expect(screen.getByRole('menu')).toBeTruthy();
  expect(document.activeElement.textContent).toBe('Move down');
  expect(screen.getByRole('menuitem', { name: 'Move up' }).disabled).toBe(true);
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
it('reorders and removes from the overflow menu', () => {
  const { ref } = setup();
  act(() => ref.current.openBuilderWithExercises(exercises));
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Exercise a' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Exercise a' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
  expect(screen.queryByText('Exercise a')).toBeNull();
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
