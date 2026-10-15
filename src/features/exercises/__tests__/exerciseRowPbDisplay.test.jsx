// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ExerciseRow from '../ExerciseRow';

const pbDisplay = vi.hoisted(() => ({ on: false }));
vi.mock('../showExercisePbDisplay', () => ({
  get SHOW_EXERCISE_PB_DISPLAY() { return pbDisplay.on; },
}));

const ex = {
  id: 'bench',
  name: 'Bench Press',
  category: 'strength',
  muscleGroup: 'chest',
  baseXP: 50,
  difficulty: 'Advanced',
};

beforeEach(() => { pbDisplay.on = false; });
afterEach(() => { cleanup(); });

it('hides the trophy and personal-best label when the flag is off', () => {
  render(<ExerciseRow ex={ex} showPB onActivate={() => {}} />);
  expect(screen.queryByText('🏆')).toBeNull();
  expect(screen.getByRole('button', { name: /Bench Press/ }).getAttribute('aria-label')).not.toMatch(/personal best/i);
});

it('shows the trophy and personal-best label when the flag and showPB are on', () => {
  pbDisplay.on = true;
  render(<ExerciseRow ex={ex} showPB onActivate={() => {}} />);
  expect(screen.getByText('🏆')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Bench Press/ }).getAttribute('aria-label')).toMatch(/personal best/i);
});
