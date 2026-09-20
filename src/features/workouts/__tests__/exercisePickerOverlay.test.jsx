// @vitest-environment jsdom
import React, { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import WorkoutsTabContainer from '../WorkoutsTabContainer';

const css = readFileSync('src/styles/app.css', 'utf8');

vi.mock('../useBuilderPointerDnd', () => ({ useBuilderPointerDnd() {} }));
vi.mock('../detailsFire', () => ({ createDetailsFire: () => ({ start() {}, stop() {}, destroy() {} }) }));

const allExercises = [
  { id: 'ex-a', name: 'Bench Press', category: 'strength', muscleGroup: 'chest', equipment: 'barbell' },
  { id: 'ex-b', name: 'Row', category: 'strength', muscleGroup: 'back', equipment: 'barbell' },
  { id: 'ex-c', name: 'Squat', category: 'strength', muscleGroup: 'quads', equipment: 'barbell' },
];
const allExById = Object.fromEntries(allExercises.map(ex => [ex.id, ex]));

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  document.body.innerHTML = '<div id="root" class="hud"></div>';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  const ref = createRef();
  const view = render(
    <WorkoutsTabContainer
      ref={ref}
      isActive
      profile={{ workouts: [], workoutLabels: [], chosenClass: null, units: 'imperial' }}
      allExById={allExById}
      allExercises={allExercises}
      setProfile={vi.fn()}
      showToast={vi.fn()}
    />,
    { container: document.getElementById('root') }
  );
  act(() => ref.current.showBuilder());
  return view;
}

it('keeps the builder Add Exercise control in the techniques header', () => {
  const { container } = setup();
  const add = screen.getByRole('button', { name: '＋ Add Exercise' });
  expect(add.closest('.wb-footer')).toBeNull();
  expect(add.closest('.wb-add-ex-overlay')).toBeNull();
  expect(container.querySelector('.wb-section-hdr, .wo-section-hdr')).toBeTruthy();
});

it('opens a glass swipe-dismiss picker and overlays a shrink-wrapped Add N control', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: '＋ Add Exercise' }));
  const dialog = screen.getByRole('dialog', { name: 'Add exercises to workout' });
  expect(dialog.classList.contains('ui-sheet--glass')).toBe(true);
  expect(dialog.classList.contains('ui-sheet--swipe')).toBe(true);
  expect(dialog.classList.contains('wb-picker-sheet')).toBe(true);
  expect(dialog.closest('.ui-sheet-backdrop--nav')).toBeNull();

  fireEvent.click(screen.getByText('Bench Press'));
  const commit = screen.getByRole('button', { name: '＋ Add 1' });
  expect(commit.closest('.wb-picker-add-overlay')).toBeTruthy();
  expect(commit.className).toMatch(/wb-picker-add-btn/);
  expect(commit.className).not.toMatch(/btn-gold/);
  expect(dialog.querySelector('.wb-picker-list-wrap.has-add-overlay')).toBeTruthy();
  const btnRule = css.slice(css.indexOf('.wb-picker-add-btn{'), css.indexOf('.wb-picker-add-btn:hover'));
  expect(btnRule).toMatch(/width:\s*auto/);
  expect(btnRule).not.toMatch(/width:\s*100%/);
  expect(css).toMatch(/\.wb-picker-sheet\{[^}]*height:\s*100%/);
  expect(css).toMatch(/\.ui-sheet-backdrop:has\(\.wb-picker-sheet\)\{[^}]*align-items:\s*stretch/);
});
