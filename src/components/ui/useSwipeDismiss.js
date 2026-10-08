import { useEffect, useRef, useState } from 'react';

/** Pixels of downward travel before a pull-to-dismiss commits. */
export const SWIPE_DISMISS_PX = 72;

function eventY(e) {
  if (e.touches && e.touches[0]) return e.touches[0].clientY;
  if (e.changedTouches && e.changedTouches[0]) return e.changedTouches[0].clientY;
  return e.clientY;
}

function isChrome(target) {
  return !!(target?.closest?.('.ui-sheet-handle') || target?.closest?.('.ui-sheet-header'));
}

function isTypingTarget(target) {
  return !!target?.closest?.('input, textarea, select, [contenteditable="true"]');
}

/**
 * Pull-down dismiss for a bottom sheet. Dragging the handle/header always
 * starts a dismiss; a pull that begins in the body only starts when the
 * body's scroller (or the caller's inner virtualized list) is at the top —
 * so a list scroll does not steal the exit gesture, and a pull from the
 * top of the list *does* close the sheet.
 */
export function useSwipeDismiss({
  enabled,
  onClose,
  dialogRef,
  bodyScrollable,
  innerScrolledToTop = true,
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const onCloseRef = useRef(onClose);
  const innerTopRef = useRef(innerScrolledToTop);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { innerTopRef.current = innerScrolledToTop; }, [innerScrolledToTop]);

  useEffect(() => {
    if (!enabled) return undefined;
    const el = dialogRef.current;
    if (!el) return undefined;

    const bodyAtTop = () => {
      if (bodyScrollable) {
        const body = el.querySelector('.ui-sheet-body');
        return !body || body.scrollTop <= 0;
      }
      return innerTopRef.current !== false;
    };

    const onDown = e => {
      const y = eventY(e);
      if (y == null) return;
      const target = e.target;
      // Close / New Custom / filter chips must stay tappable. A pull that
      // *starts* on a header button is a click, not a dismiss.
      if (isChrome(target) && target.closest?.('button, a')) return;
      if (isTypingTarget(target)) return;
      if (!isChrome(target) && !bodyAtTop()) return;
      drag.current = { startY: y, dy: 0 };
    };

    const onMove = e => {
      if (!drag.current) return;
      const y = eventY(e);
      if (y == null) return;
      if (!isChrome(e.target) && !bodyAtTop()) {
        drag.current = null;
        setOffset(0);
        setDragging(false);
        return;
      }
      const dy = Math.max(0, y - drag.current.startY);
      drag.current.dy = dy;
      if (dy > 4) {
        setDragging(true);
        setOffset(dy);
        if (e.cancelable) e.preventDefault();
      }
    };

    const finish = () => {
      if (!drag.current) return;
      const dy = drag.current.dy;
      drag.current = null;
      setDragging(false);
      setOffset(0);
      if (dy >= SWIPE_DISMISS_PX) onCloseRef.current?.();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('touchstart', onDown, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', finish);
    el.addEventListener('touchcancel', finish);

    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', finish);
      el.removeEventListener('pointercancel', finish);
      el.removeEventListener('touchstart', onDown);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', finish);
      el.removeEventListener('touchcancel', finish);
    };
  }, [enabled, dialogRef, bodyScrollable]);

  return { offset, dragging };
}
