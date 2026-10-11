// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ExerciseRow, { exerciseRowLabel } from '../ExerciseRow';

const ex = {
  id: 'bench',
  name: 'Bench Press',
  category: 'strength',
  muscleGroup: 'chest',
  equipment: 'barbell',
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

it('keeps difficulty, muscle, and equipment in the accessible label', () => {
  expect(exerciseRowLabel(ex)).toBe('Bench Press, Strength, Chest, Barbell, Advanced');
  expect(exerciseRowLabel({
    name: 'Jog',
    category: 'cardio',
    muscleGroup: 'cardio',
    equipment: 'bodyweight',
    baseXP: 20,
  })).toBe('Jog, Cardio, Cardio, Bodyweight, Beginner');
  render(
    <ExerciseRow
      ex={ex}
      onActivate={() => {}}
      onToggleSelect={() => {}}
    />
  );
  const nameBtn = screen.getByRole('button', { name: 'Bench Press, Strength, Chest, Barbell, Advanced' });
  expect(nameBtn.textContent).toBe('Bench Press');
  expect(nameBtn.getAttribute('aria-label')).toContain('Advanced');
  expect(document.querySelector('.picker-ex-meta').textContent).toMatch(/Chest/);
  expect(document.querySelector('.picker-ex-meta').textContent).toMatch(/Barbell/);
  expect(document.querySelector('.picker-ex-xp')).toBeNull();
});

const customEx = { ...ex, id: 'fly', name: 'Cable Fly', custom: true };

it('prefixes Custom on the meta line and in the accessible label', () => {
  expect(exerciseRowLabel(customEx)).toBe('Cable Fly, Custom, Strength, Chest, Barbell, Advanced');
  render(<ExerciseRow ex={customEx} showEquipment onActivate={() => {}} onToggleSelect={() => {}} />);
  expect(document.querySelector('.picker-ex-meta').textContent).toBe('Custom · Chest · Barbell');
  expect(screen.getByRole('button', { name: 'Cable Fly, Custom, Strength, Chest, Barbell, Advanced' })).toBeTruthy();
});

it('opens the overflow menu without toggling the row or the checkbox', () => {
  const onActivate = vi.fn();
  const onToggleSelect = vi.fn();
  const onEdit = vi.fn();
  const onDuplicate = vi.fn();
  const onDelete = vi.fn();
  render(
    <ExerciseRow
      ex={customEx}
      onActivate={onActivate}
      onToggleSelect={onToggleSelect}
      onEdit={onEdit}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
    />
  );
  const more = screen.getByRole('button', { name: 'More actions for Cable Fly' });
  expect(more.getAttribute('aria-haspopup')).toBe('menu');
  expect(more.getAttribute('aria-expanded')).toBe('false');
  fireEvent.pointerDown(more);
  expect(document.querySelector('.picker-ex-row').classList.contains('no-row-press')).toBe(true);
  fireEvent.click(more);
  expect(onActivate).not.toHaveBeenCalled();
  expect(onToggleSelect).not.toHaveBeenCalled();
  expect(more.getAttribute('aria-expanded')).toBe('true');
  const menu = screen.getByRole('menu');
  expect(menu).toBeTruthy();
  expect(menu.getAttribute('data-placement')).toMatch(/^(up|down)$/);

  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).toBeNull();

  fireEvent.click(more);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
  expect(onDuplicate).toHaveBeenCalledTimes(1);

  fireEvent.click(more);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
  expect(onDelete).toHaveBeenCalledTimes(1);
  expect(onActivate).not.toHaveBeenCalled();
  expect(onToggleSelect).not.toHaveBeenCalled();
});

it('returns focus to the overflow trigger on Escape', () => {
  render(
    <ExerciseRow
      ex={customEx}
      onActivate={() => {}}
      onEdit={() => {}}
      onDuplicate={() => {}}
      onDelete={() => {}}
    />
  );
  const more = screen.getByRole('button', { name: 'More actions for Cable Fly' });
  fireEvent.click(more);
  expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(more);
});
