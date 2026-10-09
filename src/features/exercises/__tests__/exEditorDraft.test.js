import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { newExDraft } from '../exEditorDraft';

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

describe('newExDraft', () => {
  it('edit keeps the existing id and name so save can find the row', () => {
    const d = newExDraft(base, 'edit');
    expect(d.id).toBe('custom-bench');
    expect(d.name).toBe('My Bench');
    expect(d.equipment).toBe('barbell');
    expect(d.difficulty).toBe('Intermediate');
  });

  it('copy and create mint a new id; copy appends (Copy)', () => {
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
});

describe('App wires edit so it actually saves', () => {
  const app = readFileSync(ROOT + 'src/App.jsx', 'utf8');

  it('passes the editor mode into newExDraft', () => {
    expect(app).toMatch(/newExDraft\(mode === "create" \? null : baseEx,\s*mode\)/);
  });

  it('matches the saved row by draft id, not a freshly minted one', () => {
    const body = app.slice(app.indexOf('function saveExEditor()'), app.indexOf('function saveExEditor()') + 700);
    expect(body).toContain('e.id === d.id');
    expect(body).not.toMatch(/Exercise patched/);
  });
});
