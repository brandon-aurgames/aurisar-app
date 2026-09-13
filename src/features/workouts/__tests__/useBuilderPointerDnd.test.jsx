// @vitest-environment jsdom
import React, { useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useBuilderPointerDnd } from '../useBuilderPointerDnd';
import { reorderExercise } from '../supersetModel';

const exercises = ['A', 'B', 'C', 'D'].map(exId => ({ exId }));
function Fixture({ onReorder, onMerge }) {
  const listRef = useRef(null);
  useBuilderPointerDnd({ listRef, exercises, onReorder, onMerge });
  return <div ref={listRef}><div className="wb-drop-line" />{exercises.map((ex, i) =>
    <div key={ex.exId} className="wb-ex-row" data-wb-idx={i}><span data-drag-handle="true">{ex.exId}</span></div>
  )}</div>;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => { cleanup(); vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function startDrag(y) {
  const onReorder = vi.fn(), onMerge = vi.fn();
  const view = render(<Fixture onReorder={onReorder} onMerge={onMerge} />);
  const cards = view.container.querySelectorAll('.wb-ex-row');
  cards.forEach((card, i) => { card.getBoundingClientRect = () => ({ left: 0, top: 100 + i * 100, bottom: 200 + i * 100, width: 400, height: 100 }); });
  function pointer(target, type, x, py) {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: py, button: 0 });
    fireEvent(target, event);
  }
  pointer(cards[0].firstChild, 'pointerdown', 20, 150);
  act(() => vi.advanceTimersByTime(50));
  pointer(window, 'pointermove', 20, y);
  return { onReorder, onMerge, view };
}
it('drops a downward move at the visible gap, without skipping another row', () => {
  const { onReorder } = startDrag(399);
  fireEvent(window, new Event('pointerup'));
  expect(onReorder).toHaveBeenCalledWith(0, 2);
  expect(reorderExercise(exercises, ...onReorder.mock.calls[0]).map(ex => ex.exId)).toEqual(['B', 'C', 'A', 'D']);
});
it.each(['pointercancel', 'blur'])('cancels an armed merge on %s without changing the workout', event => {
  const { onReorder, onMerge, view } = startDrag(350);
  expect(view.container.querySelector('.ss-target')).toBeTruthy();
  fireEvent(window, new Event(event));
  expect(onReorder).not.toHaveBeenCalled();
  expect(onMerge).not.toHaveBeenCalled();
  expect(document.querySelector('.wb-drag-ghost')).toBeNull();
  expect(view.container.querySelector('.ss-target')).toBeNull();
});
