// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Sheet from '../Sheet';
import { SWIPE_DISMISS_PX } from '../useSwipeDismiss';

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
  cleanup();
});

function drag(el, fromY, toY) {
  fireEvent.pointerDown(el, { clientY: fromY, pointerId: 1 });
  fireEvent.pointerMove(el, { clientY: toY, pointerId: 1 });
  fireEvent.pointerUp(el, { clientY: toY, pointerId: 1 });
}

describe('Sheet swipeDismiss', () => {
  it('closes a bottom sheet pulled down past the threshold from the handle', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} swipeDismiss ariaLabel="Picker">
        <div>rows</div>
      </Sheet>,
      { container: document.getElementById('root') }
    );
    const handle = document.querySelector('.ui-sheet-handle');
    expect(handle).toBeTruthy();
    drag(handle, 80, 80 + SWIPE_DISMISS_PX + 8);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open when the pull is shorter than the threshold', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} swipeDismiss ariaLabel="Picker">
        <div>rows</div>
      </Sheet>,
      { container: document.getElementById('root') }
    );
    drag(document.querySelector('.ui-sheet-handle'), 80, 80 + 20);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Picker' })).toBeTruthy();
  });

  it('does not start a dismiss from the close button', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} swipeDismiss ariaLabel="Picker">
        <div>rows</div>
      </Sheet>,
      { container: document.getElementById('root') }
    );
    const close = screen.getByRole('button', { name: 'Close' });
    drag(close, 40, 40 + SWIPE_DISMISS_PX + 20);
    // click handler on the button still works; a drag-from-button must not
    // *also* fire a swipe close (that would double-close). The pointer path
    // ignores header buttons, so only a real click calls onClose.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not steal a pull when the inner list is not at the top', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} swipeDismiss scroll="none" innerScrolledToTop={false} ariaLabel="Picker">
        <div className="wb-picker-list-wrap">scrolled list</div>
      </Sheet>,
      { container: document.getElementById('root') }
    );
    drag(screen.getByText('scrolled list'), 200, 200 + SWIPE_DISMISS_PX + 20);
    expect(onClose).not.toHaveBeenCalled();
  });
});
