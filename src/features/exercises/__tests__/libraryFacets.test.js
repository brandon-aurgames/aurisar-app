import { describe, it, expect } from 'vitest';
import { filterAndCount } from '../filterPass';
import {
  difficultyKey, goalKey, movementKey, GOAL_OPTS, DIFFICULTY_OPTS, MOVEMENT_OPTS,
} from '../libraryFacets';
import { regionsForMuscle, muscleForRegion, anatomyFallbackViews } from '../anatomyRegions';
import { splitInstructions } from '../splitInstructions';
import { illustrationKey } from '../illustrationKey';

const S = (...v) => new Set(v);
const ex = (over = {}) => ({
  id: over.id || 'x',
  name: over.name || 'Move',
  muscleGroup: 'chest',
  category: 'strength',
  exerciseType: 'strength',
  equipment: 'barbell',
  isolation: false,
  compound: true,
  difficulty: 'Intermediate',
  baseXP: 50,
  ...over,
});

describe('library facet meaning', () => {
  it('maps isolation strength work to hypertrophy and compound to strength', () => {
    expect(goalKey(ex({ isolation: true }))).toBe('hypertrophy');
    expect(goalKey(ex({ isolation: false, compound: true }))).toBe('strength');
  });

  it('maps cardio/endurance to endurance and leaves flexibility unlabelled', () => {
    expect(goalKey(ex({ category: 'cardio', exerciseType: 'cardio' }))).toBe('endurance');
    expect(goalKey(ex({ category: 'flexibility', exerciseType: 'flexibility' }))).toBe(null);
  });

  it('treats isolation flag as movement isolation, otherwise compound', () => {
    expect(movementKey(ex({ isolation: true }))).toBe('isolation');
    expect(movementKey(ex({ isolation: false }))).toBe('compound');
  });

  it('uses catalog difficulty when present', () => {
    expect(difficultyKey(ex({ difficulty: 'Beginner' }))).toBe('Beginner');
    expect(DIFFICULTY_OPTS).toContain('Advanced');
    expect(GOAL_OPTS).toEqual(['strength', 'hypertrophy', 'endurance']);
    expect(MOVEMENT_OPTS).toEqual(['compound', 'isolation']);
  });
});

describe('OR within / AND across including new facets', () => {
  const catalog = [
    ex({ id: 'bench', equipment: 'barbell', isolation: false }),
    ex({ id: 'fly', equipment: 'dumbbell', isolation: true, difficulty: 'Beginner' }),
    ex({ id: 'cable', equipment: 'cable', isolation: true }),
  ];

  it('ORs two equipment types and drops the deselected one', () => {
    const two = filterAndCount(catalog, { equipSet: S('barbell', 'dumbbell') });
    expect(two.list.map(e => e.id).sort()).toEqual(['bench', 'fly']);
    const one = filterAndCount(catalog, { equipSet: S('barbell') });
    expect(one.list.map(e => e.id)).toEqual(['bench']);
    expect(one.equipCounts.get('dumbbell')).toBe(1);
    expect(one.equipCounts.get('barbell')).toBe(1);
  });

  it('ANDs equipment with muscle and does not let a facet constrain its own counts', () => {
    const { list, equipCounts, difficultyCounts } = filterAndCount(catalog, {
      muscleSet: S('chest'),
      equipSet: S('barbell'),
    });
    expect(list.map(e => e.id)).toEqual(['bench']);
    expect(equipCounts.get('barbell')).toBe(1);
    expect(equipCounts.get('dumbbell')).toBe(1);
    expect(difficultyCounts.get('Intermediate')).toBe(1);
  });
});

describe('anatomy region mapping', () => {
  it('highlights matching regions on both views for legs and keeps lats posterior', () => {
    expect(regionsForMuscle('legs')).toEqual(['quads', 'hamstrings']);
    expect(anatomyFallbackViews('chest')).toEqual(['front']);
    expect(anatomyFallbackViews('glutes')).toEqual(['back']);
    expect(muscleForRegion('lats')).toBe('back');
    expect(muscleForRegion('chest')).toBe('chest');
  });
});

describe('instructions split', () => {
  it('uses real description sentences rather than invented copy', () => {
    const { setup, movement } = splitInstructions('Sit on the bench. Press the bar up. Lower under control.');
    expect(setup).toContain('Sit on the bench');
    expect(movement).toBeTruthy();
    expect(`${setup} ${movement}`).toContain('Press the bar up');
  });
  it('keeps a single sentence as setup', () => {
    expect(splitInstructions('Just hang.')).toEqual({ setup: 'Just hang.', movement: null });
  });
});

describe('illustration keys', () => {
  it('distinguishes the six authored movements', () => {
    expect(illustrationKey('Bench Press')).toBe('bench-press');
    expect(illustrationKey('Box Squat with Bands')).toBe('box-squat-bands');
    expect(illustrationKey('Barbell Squat')).toBe('squat');
    expect(illustrationKey('Overhead Press')).toBe('overhead-press');
    expect(illustrationKey('Deadlift')).toBe('deadlift');
    expect(illustrationKey('Pullups')).toBe('pull-up');
    expect(illustrationKey('Cable Fly')).toBe(null);
  });
});
