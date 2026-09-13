// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import WorkoutDetails from '../WorkoutDetails';

const fx = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), destroy: vi.fn() }));
vi.mock('../detailsFire', () => ({ createDetailsFire: () => fx }));
let reduce = false;
beforeEach(() => {
  vi.useFakeTimers(); reduce = false;
  vi.stubGlobal('matchMedia', () => ({ matches: reduce }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => { cleanup(); vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function setup(overrides = {}) {
  const onSave = vi.fn();
  const props = { name: 'Push Day', notes: 'Steady pace', intensity: 'moderate', exercises: [{ exId: 'test', sets: 3, reps: 12 }], allExById: { test: { name: 'Push Ups', category: 'strength' } }, onSave, ...overrides };
  const view = render(<WorkoutDetails {...props} />, { container: document.getElementById('root') });
  const trigger = screen.getByRole('button', { name: 'Open workout details' });
  return { ...view, props, trigger, onSave };
}
const advance = n => act(() => vi.advanceTimersByTime(n));

describe('Workout Details interaction', () => {
  it('follows the HUD edge through desktop resize and clamps mobile positioning', () => {
    const root = document.getElementById('root');
    root.className = 'hud';
    let left = 400;
    root.getBoundingClientRect = () => ({ left });
    const { trigger } = setup();
    expect(trigger.style.getPropertyValue('--wd-left')).toBe('400px');
    left = 120; fireEvent(window, new Event('resize'));
    expect(trigger.style.getPropertyValue('--wd-left')).toBe('120px');
    left = -5; fireEvent(document, new Event('scroll'));
    expect(trigger.style.getPropertyValue('--wd-left')).toBe('0px');
  });

  it('reveals for a mouse or pen regardless of media queries, but touch activates directly', () => {
    const { trigger } = setup();
    function enter(pointerType) {
      const event = new Event('pointerover', { bubbles: true });
      Object.defineProperty(event, 'pointerType', { value: pointerType });
      fireEvent(trigger, event);
    }
    for (const type of ['mouse', 'pen']) {
      enter(type);
      expect(trigger.dataset.hovered).toBe('true');
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.pointerOut(trigger);
      expect(trigger.dataset.hovered).toBe('false');
    }
    enter('touch');
    expect(trigger.dataset.hovered).toBe('false');
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('keeps intensity unset and allows clearing a selection before saving', () => {
    const { trigger, onSave } = setup({ intensity: '' });
    fireEvent.click(trigger);
    expect(screen.getAllByRole('radio').every(r => !r.checked)).toBe(true);
    fireEvent.click(screen.getByLabelText('High'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear intensity' }));
    fireEvent.submit(screen.getByLabelText('Workout Name').closest('form'));
    expect(onSave.mock.calls[0][0].intensity).toBe('');
  });

  it('opens only on activation, traps focus, and restores it after Escape', () => {
    const { trigger, onSave } = setup();
    fireEvent.mouseEnter(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(trigger); advance(32);
    const dialog = screen.getByRole('dialog', { name: 'Workout details' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.classList.contains('ui-sheet--fullscreen')).toBe(true);
    expect(document.getElementById('root').hasAttribute('inert')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(dialog);
    const save = screen.getByRole('button', { name: 'SAVE DETAILS' });
    save.focus(); fireEvent.keyDown(save, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
    fireEvent.keyDown(dialog, { key: 'Escape' }); advance(400); advance(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.getElementById('root').hasAttribute('inert')).toBe(false);
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
    expect(onSave).not.toHaveBeenCalled();
    advance(800); expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('applies name, notes and intensity together; closing discards later edits', () => {
    const { trigger, onSave, rerender, props } = setup();
    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText('Workout Name'), { target: { value: 'Shadow Endurance' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Focus on form' } });
    fireEvent.click(screen.getByLabelText('High'));
    fireEvent.submit(screen.getByLabelText('Workout Name').closest('form'));
    expect(onSave).toHaveBeenCalledWith({ name: 'Shadow Endurance', notes: 'Focus on form', intensity: 'high' });
    rerender(<WorkoutDetails {...props} {...onSave.mock.calls[0][0]} />); advance(400);
    fireEvent.click(trigger);
    expect(screen.getByLabelText('Workout Name').value).toBe('Shadow Endurance');
    expect(screen.getByLabelText('High').checked).toBe(true);
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Discard me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); advance(400);
    fireEvent.click(trigger);
    expect(screen.getByLabelText('Notes').value).toBe('Focus on form');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('opens/closes immediately with reduced motion and cleans up on unmount', () => {
    reduce = true;
    const { trigger, unmount } = setup();
    fireEvent.click(trigger);
    expect(document.querySelector('.wd-opening')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' })); advance(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(trigger);
    unmount(); advance(700);
    expect(document.body.style.overflow).toBe('');
    expect(document.getElementById('root').hasAttribute('inert')).toBe(false);
    expect(fx.destroy).toHaveBeenCalled();
  });

  it('retains PR 358 session fields and group summaries without mutating exercises', () => {
    reduce = true;
    const exercises = Array.from({ length: 4 }, () => ({ exId: 'test', ssGroupId: 'group-1', sets: 3, reps: 12, extraRows: [{ sets: 2, reps: 8 }] }));
    const snapshot = structuredClone(exercises);
    const { trigger, onSave } = setup({ exercises, availableLabels: ['Push'], session: { labels: ['Push'], duration: '00:45', durationSec: '', activeCal: '300', totalCal: '400' } });
    fireEvent.click(trigger);
    expect(screen.getByText('A4')).toBeTruthy();
    expect(screen.getAllByText('5 sets · 12 reps + varied sets')).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '01:70:90' } });
    fireEvent.change(screen.getByLabelText('Active Cal'), { target: { value: '350' } });
    fireEvent.change(screen.getByLabelText('New label'), { target: { value: 'Strength' } });
    fireEvent.keyDown(screen.getByLabelText('New label'), { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByLabelText('Workout Name').closest('form'));
    expect(onSave.mock.calls[0][0].session).toEqual({ labels: ['Push', 'Strength'], duration: '02:10:59', durationSec: '', activeCal: '350', totalCal: '400' });
    expect(exercises).toEqual(snapshot);
    advance(1); fireEvent.click(trigger);
    expect(screen.getByLabelText('Duration').value).toBe('00:45');
    fireEvent.change(screen.getByLabelText('Total Cal'), { target: { value: '600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); advance(1);
    fireEvent.click(trigger);
    expect(screen.getByLabelText('Total Cal').value).toBe('400');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('pauses effect work when the page is hidden', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(fx.stop).toHaveBeenCalled();
    expect(document.querySelector('.wd-backdrop').classList.contains('wd-paused')).toBe(true);
    vi.restoreAllMocks();
  });
});
