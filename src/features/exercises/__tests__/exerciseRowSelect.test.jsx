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
  fireEvent.click(screen.getByRole('checkbox', { name: 'Add Bench Press to selection' }));
  expect(onToggleSelect).toHaveBeenCalledWith('bench');
  expect(onActivate).not.toHaveBeenCalled();
});

it('marks the row so a checkbox press does not play the row scale', () => {
  render(
    <ExerciseRow
      ex={ex}
      onActivate={() => {}}
      onToggleSelect={() => {}}
    />
  );
  const row = document.querySelector('.picker-ex-row');
  const box = screen.getByRole('checkbox', { name: 'Add Bench Press to selection' });
  fireEvent.pointerDown(box);
  expect(row.classList.contains('no-row-press')).toBe(true);
});

it('exposes checkbox semantics and the selected name', () => {
  render(
    <ExerciseRow
      ex={ex}
      selected
      onActivate={() => {}}
      onToggleSelect={() => {}}
    />
  );
  const box = screen.getByRole('checkbox', { name: 'Remove Bench Press from selection' });
  expect(box.getAttribute('aria-checked')).toBe('true');
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
