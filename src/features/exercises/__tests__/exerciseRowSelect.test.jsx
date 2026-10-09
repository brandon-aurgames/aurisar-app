// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ExerciseRow from '../ExerciseRow';

const ex = {
  id: 'bench',
  name: 'Bench Press',
  category: 'strength',
  muscleGroup: 'chest',
  baseXP: 50,
  difficulty: 'Advanced',
};

afterEach(() => { cleanup(); });

it('always-on checkbox toggles selection without opening the row', () => {
  const onActivate = vi.fn();
  const onToggleSelect = vi.fn();
  render(
    <ExerciseRow
      ex={ex}
      selected={false}
      onActivate={onActivate}
      onToggleSelect={onToggleSelect}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add Bench Press' }));
  expect(onToggleSelect).toHaveBeenCalledWith('bench');
  expect(onActivate).not.toHaveBeenCalled();
});

it('row body still opens detail', () => {
  const onActivate = vi.fn();
  render(
    <ExerciseRow
      ex={ex}
      onActivate={onActivate}
      onToggleSelect={() => {}}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /Bench Press, Strength/ }));
  expect(onActivate).toHaveBeenCalledTimes(1);
});
