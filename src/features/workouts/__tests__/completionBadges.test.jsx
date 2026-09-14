// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import HistoryTab from '../../history/HistoryTab';
import CalendarTab from '../../calendar/CalendarTab';

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(['history', 'calendar'])('%s uses completion snapshots even after source edits or deletion', surface => {
  const log = ['a', 'b', 'c'].map((exId, index) => ({
    exId, exercise: `Exercise ${exId}`, sets: 3, reps: 10, xp: 10,
    sourceWorkoutId: 'workout', sourceWorkoutName: 'Original workout', sourceGroupId: 'session',
    dateKey: '2026-09-13', date: '9/13/2026', time: '12:00',
    ...(index === 0 ? { ssGroupId: 'original-group' } : index === 1 ? { ssGroupId: null } : {}),
  }));
  const allExById = Object.fromEntries(log.map(entry => [entry.exId, { category: 'strength', muscleGroup: 'chest' }]));
  // The current template disagrees with both saved membership and legacy unknown membership.
  const profile = { log, xp: 30, units: 'imperial', plans: [], workouts: [{
    id: 'workout', exercises: [{ exId: 'a' }, { exId: 'b', ssGroupId: 'new-group' }, { exId: 'c', ssGroupId: 'new-group' }],
  }] };
  const props = { profile, allExById, logSubTab: 'workouts', openLogGroups: { session: true, cal_session: true }, calViewDate: { y: 2026, m: 8 }, calSelDate: '2026-09-13' };
  const Tab = surface === 'history' ? HistoryTab : CalendarTab;
  const badge = surface === 'history' ? 'Superset' : 'SS';
  const { rerender } = render(<Tab {...props} />);
  expect(screen.getAllByText(badge)).toHaveLength(1);
  expect(screen.getByText(badge).closest('.h-entry').textContent).toContain('Exercise a');
  rerender(<Tab {...props} profile={{ ...profile, workouts: [] }} />);
  expect(screen.getAllByText(badge)).toHaveLength(1);
});
