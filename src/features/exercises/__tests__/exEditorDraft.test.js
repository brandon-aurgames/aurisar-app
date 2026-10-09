import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { calcExercisePBs } from '../../../utils/xp';
import { newExDraft, saveCustomExercise, mergeEditedExercise, PB_FIELDS } from '../exEditorDraft';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const base = {
  id: 'custom-bench',
  name: 'My Bench',
  icon: '🏋️',
  category: 'strength',
  muscleGroup: 'chest',
  equipment: 'barbell',
  difficulty: 'Intermediate',
  baseXP: 50,
  tips: ['Elbows in'],
};

const sharedCustom = {
  ...base,
  id: 'shared-bench',
  name: 'Friend Bench',
  custom: true,
  pbType: 'Strength 1RM',
  pbTier: 'Personal',
  primaryPBMetric: 'Heaviest 1×1 set (lbs)',
  markAsPB: true,
  sharedFrom: 'alice',
  legacyNote: 'keep me',
  tips: ['Elbows in', 'Feet planted', 'Pause on chest', 'Drive the floor'],
};

describe('newExDraft', () => {
  it('edit keeps the existing id, name, extra fields and all tips', () => {
    const d = newExDraft(sharedCustom, 'edit');
    expect(d.id).toBe('shared-bench');
    expect(d.name).toBe('Friend Bench');
    expect(d.equipment).toBe('barbell');
    expect(d.difficulty).toBe('Intermediate');
    expect(d.sharedFrom).toBe('alice');
    expect(d.legacyNote).toBe('keep me');
    expect(d.tips).toEqual(sharedCustom.tips);
    expect(d.tips).toHaveLength(4);
    for (const key of PB_FIELDS) expect(d[key]).toBe(sharedCustom[key]);
  });

  it('copy and create mint a new id; copy appends (Copy) and carries pbType', () => {
    const copy = newExDraft(base, 'copy');
    expect(copy.id).not.toBe('custom-bench');
    expect(copy.name).toBe('My Bench (Copy)');
    expect(copy.equipment).toBe('barbell');

    const created = newExDraft(null, 'create');
    expect(created.id).toBeTruthy();
    expect(created.id).not.toBe('custom-bench');
    expect(created.name).toBe('');
    expect(created.equipment).toBe('bodyweight');
  });

  it('copying Bench Press carries pbType so the copy still tracks PBs', () => {
    const bench = {
      id: 'bench',
      name: 'Bench Press',
      pbType: 'Strength 1RM',
      pbTier: 'Leaderboard',
      primaryPBMetric: 'Heaviest 1×1 set (lbs)',
      markAsPB: true,
      category: 'strength',
      muscleGroup: 'chest',
      equipment: 'barbell',
    };
    const copy = newExDraft(bench, 'copy');
    expect(copy.id).not.toBe('bench');
    expect(copy.name).toBe('Bench Press (Copy)');
    expect(copy.pbType).toBe('Strength 1RM');
    expect(copy.pbTier).toBe('Leaderboard');
    expect(copy.primaryPBMetric).toBe('Heaviest 1×1 set (lbs)');
    expect(copy.markAsPB).toBe(true);

    const saved = saveCustomExercise({ mode: 'copy', draft: copy, list: [] });
    expect(saved.item.pbType).toBe('Strength 1RM');
    const pbs = calcExercisePBs(
      [{ exId: saved.item.id, sets: 1, reps: 1, weightLbs: 185 }],
      { [saved.item.id]: saved.item },
    );
    expect(pbs[saved.item.id].type).toBe('Strength 1RM');
    expect(pbs[saved.item.id].value).toBe(185);
  });
});

describe('saveCustomExercise round-trip', () => {
  it('merges a rename into the stored row without dropping PB type, extras, or extra tips', () => {
    const draft = newExDraft(sharedCustom, 'edit');
    draft.name = 'Renamed Bench';
    const { item, list, toast } = saveCustomExercise({
      mode: 'edit',
      draft,
      list: [sharedCustom],
    });
    expect(toast).toBe('Exercise saved.');
    expect(item.id).toBe('shared-bench');
    expect(item.name).toBe('Renamed Bench');
    expect(item.pbType).toBe('Strength 1RM');
    expect(item.pbTier).toBe('Personal');
    expect(item.primaryPBMetric).toBe('Heaviest 1×1 set (lbs)');
    expect(item.markAsPB).toBe(true);
    expect(item.sharedFrom).toBe('alice');
    expect(item.legacyNote).toBe('keep me');
    expect(item.tips).toEqual(sharedCustom.tips);
    expect(list).toHaveLength(1);
    expect(list[0]).toBe(item);

    const pbs = calcExercisePBs(
      [{ exId: item.id, sets: 1, reps: 1, weightLbs: 225 }],
      { [item.id]: item },
    );
    expect(pbs[item.id].type).toBe('Strength 1RM');
    expect(pbs[item.id].value).toBe(225);
  });

  it('does not let a truncated draft wipe unmodeled fields', () => {
    const stored = { ...sharedCustom };
    const skinny = { id: stored.id, name: 'Skinny', equipment: 'dumbbell' };
    const item = mergeEditedExercise(stored, skinny);
    expect(item.id).toBe(stored.id);
    expect(item.name).toBe('Skinny');
    expect(item.equipment).toBe('dumbbell');
    expect(item.pbType).toBe('Strength 1RM');
    expect(item.tips).toEqual(stored.tips);
    expect(item.sharedFrom).toBe('alice');
  });

  it('copy and create mint new rows and use distinct toasts', () => {
    const copyDraft = newExDraft(sharedCustom, 'copy');
    const copied = saveCustomExercise({ mode: 'copy', draft: copyDraft, list: [sharedCustom] });
    expect(copied.toast).toBe('Copy created.');
    expect(copied.item.id).not.toBe('shared-bench');
    expect(copied.list).toHaveLength(2);

    const created = saveCustomExercise({
      mode: 'create',
      draft: newExDraft(null, 'create'),
      list: [],
    });
    expect(created.error).toBe('Exercise needs a name!');

    const named = saveCustomExercise({
      mode: 'create',
      draft: { ...newExDraft(null, 'create'), name: 'New Move' },
      list: [],
    });
    expect(named.toast).toBe('Exercise created.');
    expect(named.item.custom).toBe(true);
  });
});

describe('App wires edit through the merge helper', () => {
  const app = readFileSync(ROOT + 'src/App.jsx', 'utf8');

  it('passes the editor mode into newExDraft', () => {
    expect(app).toMatch(/newExDraft\(mode === "create" \? null : baseEx,\s*mode\)/);
  });

  it('saves through saveCustomExercise instead of replacing the row with the draft', () => {
    const body = app.slice(app.indexOf('function saveExEditor()'), app.indexOf('function saveExEditor()') + 700);
    expect(body).toContain('saveCustomExercise');
    expect(body).not.toMatch(/Exercise patched/);
    expect(body).not.toMatch(/e\.id === d\.id \? \{\s*\.\.\.d/);
  });
});
