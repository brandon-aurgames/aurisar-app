// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import TechSearch from '../TechSearch';
import ExerciseEditorModal from '../ExerciseEditorModal';
import { newExDraft } from '../exEditorDraft';

afterEach(() => { cleanup(); });

describe('TechSearch accessible name', () => {
  it.each([
    ['lib-search', 'Search exercises'],
    ['wb-search', 'Search exercises'],
    ['myex-search', 'Search my exercises'],
    ['ex-ed-start-from', 'Search catalog to start from'],
  ])('%s is named %s', (id, label) => {
    render(
      <TechSearch
        id={id}
        label={label}
        value=""
        onChange={() => {}}
        onClear={() => {}}
        placeholder="Search…"
      />
    );
    expect(screen.getByRole('searchbox', { name: label })).toBeTruthy();
  });
});

describe('Exercise editor labels and selection state', () => {
  function Editor() {
    const [draft, setDraft] = useState(() => newExDraft(null, 'create'));
    return (
      <ExerciseEditorModal
        exEditorDraft={draft}
        setExEditorDraft={setDraft}
        setExEditorOpen={() => {}}
        exEditorMode="create"
        allExercises={[]}
        profile={{ units: 'imperial', age: 30 }}
        saveExEditor={() => {}}
        openExEditor={() => {}}
        deleteCustomEx={() => {}}
      />
    );
  }

  it('names the identity fields and selected equipment/difficulty/category/muscle', () => {
    render(<Editor />);
    const name = screen.getByLabelText('Exercise name');
    expect(name.id).toBe('ex-ed-name');
    fireEvent.change(name, { target: { value: 'Cable Fly' } });
    expect(name.value).toBe('Cable Fly');

    expect(screen.getByLabelText(/Base XP per session/)).toBeTruthy();
    expect(screen.getByLabelText('Default sets')).toBeTruthy();
    expect(screen.getByLabelText('Default reps')).toBeTruthy();
    expect(screen.getByLabelText(/Default base weight/)).toBeTruthy();
    expect(screen.getByLabelText('Default intensity %')).toBeTruthy();
    expect(screen.getByLabelText('Default intensity').getAttribute('type')).toBe('range');

    const equipment = screen.getByRole('radiogroup', { name: 'Equipment' });
    expect(equipment.querySelector('[aria-checked="true"]').textContent.toLowerCase()).toMatch(/bodyweight/);

    fireEvent.click(screen.getByRole('radio', { name: 'Barbell' }));
    expect(screen.getByRole('radio', { name: 'Barbell' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: 'Advanced' }));
    expect(screen.getByRole('radio', { name: 'Advanced' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: 'cardio' }));
    expect(screen.getByRole('radio', { name: 'cardio' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: 'Chest' }));
    expect(screen.getByRole('radio', { name: 'Chest' }).getAttribute('aria-checked')).toBe('true');

    expect(screen.getByRole('heading', { name: 'Name & type' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Equipment & difficulty' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Logging defaults' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Details' })).toBeTruthy();
  });

  it('shows inline name validation instead of only a toast', () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole('button', { name: 'Save exercise' }));
    expect(screen.getByRole('alert').textContent).toBe('Give this exercise a name.');
  });

  it('names all three form tips', () => {
    render(<Editor />);
    for (const n of [1, 2, 3]) expect(screen.getByRole('textbox', { name: `Form tip ${n}` })).toBeTruthy();
  });

  it('radio groups use one tab stop and arrow keys move + select with wrap', () => {
    render(<Editor />);
    const group = screen.getByRole('radiogroup', { name: 'Difficulty' });
    const radios = [...group.querySelectorAll('[role="radio"]')];
    // nothing selected: first option is the single tab stop
    expect(radios.map(r => r.tabIndex)).toEqual([0, -1, -1]);
    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: 'ArrowRight' });
    expect(radios[1].getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radios[1]);
    expect(radios.map(r => r.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.keyDown(radios[1], { key: 'End' });
    expect(radios[2].getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(radios[2], { key: 'ArrowDown' });
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(radios[0], { key: 'ArrowLeft' });
    expect(radios[2].getAttribute('aria-checked')).toBe('true');
  });

  it('heart-rate zone has an explicit None option and keyboard navigation', () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole('radio', { name: 'cardio' }));
    const group = screen.getByRole('radiogroup', { name: /Default heart rate zone/ });
    const radios = [...group.querySelectorAll('[role="radio"]')];
    expect(radios[0].textContent).toBe('None');
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(radios[0], { key: 'ArrowRight' });
    expect(radios[1].getAttribute('aria-checked')).toBe('true');
    fireEvent.click(radios[1]); // re-click does not deselect
    expect(radios[1].getAttribute('aria-checked')).toBe('true');
    fireEvent.click(radios[0]);
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
  });
});
