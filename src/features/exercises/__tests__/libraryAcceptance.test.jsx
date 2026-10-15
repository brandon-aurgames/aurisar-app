// @vitest-environment jsdom
import React, { useMemo, useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExerciseLibraryTab from '../ExerciseLibraryTab';
import ExerciseDetailSheet from '../ExerciseDetailSheet';
import { filterAndCount } from '../filterPass';
import LibraryExerciseCard from '../LibraryExerciseCard';

afterEach(() => { cleanup(); });

const catalog = [
  {
    id: 'bench', name: 'Bench Press', muscleGroup: 'chest', category: 'strength',
    exerciseType: 'strength', equipment: 'barbell', difficulty: 'Intermediate',
    isolation: false, compound: true, baseXP: 55,
    desc: 'Lie on the bench with the bar above your chest. Lower the bar to your chest, then press it up.',
  },
  {
    id: 'db-bench', name: 'Incline Dumbbell Press', muscleGroup: 'chest', category: 'strength',
    exerciseType: 'strength', equipment: 'dumbbell', difficulty: 'Intermediate',
    isolation: false, compound: true, baseXP: 40, desc: 'Press the dumbbells.',
  },
  {
    id: 'fly', name: 'Cable Fly', muscleGroup: 'chest', category: 'strength',
    exerciseType: 'strength', equipment: 'cable', difficulty: 'Beginner',
    isolation: true, compound: false, baseXP: 25, desc: 'Open the arms.',
  },
  {
    id: 'squat', name: 'Barbell Squat', muscleGroup: 'legs', category: 'strength',
    exerciseType: 'strength', equipment: 'barbell', difficulty: 'Intermediate',
    isolation: false, compound: true, baseXP: 60, desc: 'Stand with the bar. Squat down.',
  },
];

function Harness({ log = [], favorites = [], cart: cartStart = [] }) {
  const [search, setSearch] = useState('');
  const [muscle, setMuscle] = useState(() => new Set());
  const [equip, setEquip] = useState(() => new Set());
  const [diff, setDiff] = useState(() => new Set());
  const [goal, setGoal] = useState(() => new Set());
  const [move, setMove] = useState(() => new Set());
  const [type, setType] = useState(() => new Set());
  const [cart, setCart] = useState(cartStart);
  const [favs, setFavs] = useState(favorites);
  const [detail, setDetail] = useState(null);
  const [siblings, setSiblings] = useState(null);
  const allExById = useMemo(() => Object.fromEntries(catalog.map(e => [e.id, e])), []);
  const pass = useMemo(() => filterAndCount(catalog, {
    query: search,
    muscleSet: muscle,
    typeSet: type,
    equipSet: equip,
    difficultySet: diff,
    goalSet: goal,
    movementSet: move,
  }), [search, muscle, type, equip, diff, goal, move]);
  const muscleCardData = ['chest', 'legs'].map(mg => ({
    mg, label: mg, count: catalog.filter(e => e.muscleGroup === mg).length, color: '#7ec8e3',
  }));
  const toggleCart = id => setCart(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id]);
  const debounced = Object.assign(vi.fn(v => setSearch(v)), { cancel: vi.fn() });

  return (
    <>
      <ExerciseLibraryTab
        libFiltered={pass.list}
        libMuscleCardData={muscleCardData}
        libEquipOpts={['barbell', 'dumbbell', 'cable']}
        libMuscleCounts={pass.muscleCounts}
        libEquipCounts={pass.equipCounts}
        libDifficultyCounts={pass.difficultyCounts}
        libGoalCounts={pass.goalCounts}
        libMovementCounts={pass.movementCounts}
        setLibSearchDebounced={setSearch}
        libTypeFilters={type} setLibTypeFilters={setType}
        libMuscleFilters={muscle} setLibMuscleFilters={setMuscle}
        libEquipFilters={equip} setLibEquipFilters={setEquip}
        libDifficultyFilters={diff} setLibDifficultyFilters={setDiff}
        libGoalFilters={goal} setLibGoalFilters={setGoal}
        libMovementFilters={move} setLibMovementFilters={setMove}
        debouncedSetLibSearch={debounced}
        libSearchDebounced={search}
        setLibDetailEx={setDetail}
        setLibDetailSiblings={setSiblings}
        cartIds={cart}
        toggleCart={toggleCart}
        clearCart={() => setCart([])}
        profile={{ favoriteExercises: favs, log, units: 'imperial', chosenClass: 'warrior' }}
        setProfile={fn => {
          const next = fn({ favoriteExercises: favs, log, units: 'imperial' });
          setFavs(next.favoriteExercises || []);
        }}
        allExercises={catalog}
        allExById={allExById}
        _exReady
        _exLoadError={false}
        openExEditor={() => {}}
      />
      <ExerciseDetailSheet
        ex={detail}
        setLibDetailEx={setDetail}
        siblings={siblings || pass.list}
        profile={{ favoriteExercises: favs, log, units: 'imperial', chosenClass: 'warrior', exercisePBs: {} }}
        setProfile={fn => {
          const next = fn({ favoriteExercises: favs, log, units: 'imperial' });
          setFavs(next.favoriteExercises || []);
        }}
        setAddToWorkoutPicker={() => {}}
        openSavePlanWizard={() => {}}
        openQuickLog={() => {}}
        allExById={allExById}
      />
    </>
  );
}

describe('library acceptance', () => {
  it('1. Choose Chest, apply Barbell, open the matching exercise', () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByRole('button', { name: /Chest,/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Barbell,/i }));
    fireEvent.click(screen.getByRole('button', { name: /Show 1 exercise/i }));
    fireEvent.click(screen.getByRole('button', { name: /Open details for Bench Press/i }));
    expect(screen.getByRole('dialog', { name: 'Bench Press' })).toBeTruthy();
    expect(within(screen.getByRole('dialog')).getByText('Bench Press')).toBeTruthy();
  });

  it('2. Select two equipment types, deselect one; state and counts agree', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Browse all/i }));
    const barbell = screen.getByRole('button', { name: /Barbell,/i });
    const dumbbell = screen.getByRole('button', { name: /Dumbbell,/i });
    fireEvent.click(barbell);
    fireEvent.click(dumbbell);
    expect(barbell.getAttribute('aria-pressed')).toBe('true');
    expect(dumbbell.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Show 3 exercises/i })).toBeTruthy();
    fireEvent.click(dumbbell);
    expect(dumbbell.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: /Show 2 exercises/i })).toBeTruthy();
  });

  it('3. Choose a muscle, go back, Browse all; summary and counts update', () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByRole('button', { name: /Chest,/i })[0]);
    expect(screen.getByText('Chest')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.click(screen.getByRole('button', { name: /Browse all/i }));
    expect(screen.getByText('All exercises')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Show 4 exercises/i })).toBeTruthy();
  });

  it('4 & 6. Favorite in Recent reflects in results and unfavorite in detail updates the star', () => {
    render(<Harness log={[{ exId: 'bench', loggedAt: Date.now() }]} />);
    const recentFav = screen.getByRole('button', { name: 'Add Bench Press to favorites' });
    fireEvent.click(recentFav);
    fireEvent.click(screen.getByRole('button', { name: /Browse all/i }));
    fireEvent.click(screen.getByRole('button', { name: /Show 4 exercises/i }));
    expect(screen.getByRole('button', { name: 'Remove Bench Press from favorites' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Open details for Bench Press/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Favorited' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('button', { name: 'Add Bench Press to favorites' })).toBeTruthy();
  });

  it('5. Clear selections removes Recent checks', () => {
    render(<Harness log={[{ exId: 'bench', loggedAt: Date.now() }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Bench Press to selection' }));
    expect(screen.getByRole('button', { name: 'Remove Bench Press from selection' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Browse all/i }));
    fireEvent.click(screen.getByRole('button', { name: /Show 4 exercises/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('Not yet in a workout')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByRole('button', { name: 'Add Bench Press to selection' })).toBeTruthy();
  });

  it('7. Search stays draft until Enter or the Search button', () => {
    render(<Harness />);
    const input = screen.getByRole('searchbox', { name: 'Search exercises' });
    fireEvent.change(input, { target: { value: 'ben' } });
    expect(screen.getByText('What are you training?')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText(/match/)).toBeTruthy();
  });

  it('8. Zero results can recover without crashing', () => {
    render(<Harness />);
    const input = screen.getByRole('searchbox', { name: 'Search exercises' });
    fireEvent.change(input, { target: { value: 'zzzz-no-hit' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('No exercises match.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.getByText('What are you training?')).toBeTruthy();
  });

  it('9. Non-illustrated exercise still highlights the correct muscle', () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByRole('button', { name: /Chest,/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Show 3 exercises/i }));
    fireEvent.click(screen.getByRole('button', { name: /Open details for Cable Fly/i }));
    const dialog = screen.getByRole('dialog', { name: 'Cable Fly' });
    expect(within(dialog).getByText('Chest')).toBeTruthy();
    expect(dialog.querySelector('.ex-lib-muscle.is-on[data-muscle="chest"]')).toBeTruthy();
    expect(dialog.querySelector('.ex-lib-muscle.is-on[data-muscle="back"]')).toBeNull();
  });

  it('10. Keyboard open, Tab containment, Escape, focus restore', async () => {
    render(<Harness log={[{ exId: 'bench', loggedAt: Date.now() }]} />);
    const card = screen.getByRole('button', { name: /Open details for Bench Press/i });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog', { name: 'Bench Press' });
    await vi.waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
    const focusable = [...dialog.querySelectorAll('button:not([disabled])')];
    focusable[focusable.length - 1].focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(focusable[0]);
    fireEvent.keyDown(document, { key: 'Escape' });
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Bench Press' })).toBeNull();
    });
  });
});

describe('library cards keep add/fav off the detail opener', () => {
  it('add and favorite do not call onOpen', () => {
    const onOpen = vi.fn();
    const onToggleFav = vi.fn();
    const onToggleSelect = vi.fn();
    render(
      <LibraryExerciseCard
        ex={catalog[0]}
        onOpen={onOpen}
        onToggleFav={onToggleFav}
        onToggleSelect={onToggleSelect}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add Bench Press to favorites' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Bench Press to selection' }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(onToggleFav).toHaveBeenCalledWith('bench');
    expect(onToggleSelect).toHaveBeenCalledWith('bench');
  });
});
