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
});
