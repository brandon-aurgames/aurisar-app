import { useEffect, useRef } from 'react';
import { canMerge } from './supersetModel';

/**
 * Pointer-based reorder for the workout builder list.
 *
 * HTML5 DnD (the previous `.wb-ex-row[draggable]` path) misfires a drag on
 * mobile scroll. This engine:
 *   - starts only from `[data-drag-handle]`
 *   - hold-to-arm on coarse pointers so a flick still scrolls
 *   - paints a floating ghost + drop line
 *   - treats the centre of another card as "merge into a superset"
 *   - cancels on Escape / blur / pointercancel
 *
 * FLIP / auto-scroll are skipped when `prefers-reduced-motion` is set.
 */
const COARSE_ARM_MS = 150;
const FINE_ARM_MS = 40;
const COARSE_CANCEL_PX = 8;
const FINE_ARM_PX = 3;
const MERGE_PAD = 0.28; // outer 28% stays insertion; centre 44% merges

function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isCoarse() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export function useBuilderPointerDnd({ listRef, exercises, onReorder, onMerge, enabled = true }) {
  const dragRef = useRef(null);
  const exercisesRef = useRef(exercises);
  exercisesRef.current = exercises;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const onMergeRef = useRef(onMerge);
  onMergeRef.current = onMerge;

  useEffect(() => {
    if (!enabled) return undefined;
    const root = listRef.current;
    if (!root) return undefined;

    let drag = null;
    let suppressClick = false;
    let scrollRaf = null;

    function cards() {
      return [...root.querySelectorAll('.wb-ex-row[data-wb-idx]')];
    }

    function slotRects(skipIdx) {
      return cards()
        .filter(el => Number(el.dataset.wbIdx) !== skipIdx)
        .map(el => ({ el, idx: Number(el.dataset.wbIdx), rect: el.getBoundingClientRect() }));
    }

    function clearVisuals() {
      const line = root.querySelector('.wb-drop-line');
      if (line) line.classList.remove('on');
      cards().forEach(c => c.classList.remove('shift-up', 'shift-down', 'ss-target', 'placeholder', 'gripping'));
    }

    function positionLine(insertAt, slots) {
      const line = root.querySelector('.wb-drop-line');
      if (!line) return;
      const wrap = root.getBoundingClientRect();
      let y;
      if (!slots.length) y = 4;
      else if (insertAt <= 0) y = slots[0].rect.top - wrap.top - 5;
      else {
        const prev = slots[Math.min(insertAt, slots.length) - 1];
        y = prev.rect.bottom - wrap.top + 4;
      }
      line.style.top = y + 'px';
      line.classList.add('on');
    }

    function ghostFrom(el, r) {
      const g = el.cloneNode(true);
      g.classList.add('wb-drag-ghost');
      g.classList.remove('placeholder', 'gripping', 'ss-target');
      g.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;margin:0`;
      document.body.appendChild(g);
      return g;
    }

    function moveGhost(x, y) {
      if (!drag || !drag.ghost) return;
      drag.ghost.style.transform =
        `translate3d(${x - drag.offX - drag.home.left}px,${y - drag.offY - drag.home.top}px,0) rotate(1.2deg) scale(1.03)`;
    }

    function mergeSlotAt(y, slots) {
      for (const s of slots) {
        const pad = s.rect.height * MERGE_PAD;
        if (y >= s.rect.top + pad && y <= s.rect.bottom - pad) {
          if (canMerge(exercisesRef.current, drag.fromIdx, s.idx)) return s;
        }
      }
      return null;
    }

    function insertionIndex(y, slots) {
      let idx = slots.length;
      for (let i = 0; i < slots.length; i++) {
        const m = slots[i].rect.top + slots[i].rect.height / 2;
        if (y < m) { idx = i; break; }
      }
      return idx;
    }

    function arm() {
      if (!drag || drag.armed) return;
      drag.armed = true;
      drag.el.classList.remove('gripping');
      document.body.classList.add('wb-dragging');
      drag.ghost = ghostFrom(drag.el, drag.home);
      drag.el.classList.add('placeholder');
      drag.slots = slotRects(drag.fromIdx);
      positionLine(drag.fromIdx, drag.slots);
    }

    function end(drop) {
      if (!drag) return;
      clearTimeout(drag.timer);
      const snapshot = drag;
      drag = null;
      dragRef.current = null;
      document.body.classList.remove('wb-dragging');
      snapshot.el.classList.remove('gripping', 'placeholder');
      if (snapshot.ghost) snapshot.ghost.remove();
      clearVisuals();
      if (!drop || !snapshot.armed) return;
      if (snapshot.mergeIdx != null) {
        onMergeRef.current?.(snapshot.fromIdx, snapshot.mergeIdx);
        return;
      }
      if (snapshot.lineIdx != null && snapshot.lineIdx !== snapshot.fromIdx) {
        // lineIdx is an insertion index in the *remaining* cards. Map it
        // back to a target index in the full list: the nth remaining card
        // (or length-1 when appending).
        const list = exercisesRef.current;
        const others = list.map((_, i) => i).filter(i => i !== snapshot.fromIdx);
        const target = snapshot.lineIdx >= others.length
          ? list.length - 1
          : others[snapshot.lineIdx];
        if (target !== snapshot.fromIdx) onReorderRef.current?.(snapshot.fromIdx, target);
      }
    }

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      const handle = e.target.closest('[data-drag-handle]');
      if (!handle || !root.contains(handle)) return;
      const card = handle.closest('.wb-ex-row[data-wb-idx]');
      if (!card) return;
      const r = card.getBoundingClientRect();
      drag = {
        el: card,
        fromIdx: Number(card.dataset.wbIdx),
        startX: e.clientX,
        startY: e.clientY,
        offX: e.clientX - r.left,
        offY: e.clientY - r.top,
        home: r,
        armed: false,
        ghost: null,
        slots: null,
        lineIdx: null,
        mergeIdx: null,
        timer: setTimeout(() => { if (drag && !drag.armed) arm(); }, isCoarse() ? COARSE_ARM_MS : FINE_ARM_MS),
      };
      dragRef.current = drag;
      card.classList.add('gripping');
    }

    function onPointerMove(e) {
      if (!drag) return;
      if (!drag.armed) {
        const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
        if (isCoarse()) {
          if (dist > COARSE_CANCEL_PX) end(false);
          return;
        }
        if (dist > FINE_ARM_PX) arm();
        return;
      }
      e.preventDefault();
      moveGhost(e.clientX, e.clientY);
      const y = e.clientY;
      if (!reducedMotion()) {
        const EDGE = 70;
        let dy = 0;
        if (y < EDGE) dy = -(EDGE - y) / 6;
        else if (y > innerHeight - EDGE) dy = (y - (innerHeight - EDGE)) / 6;
        if (dy && !scrollRaf) {
          scrollRaf = requestAnimationFrame(() => {
            scrollRaf = null;
            scrollBy(0, dy * 3);
            if (drag && drag.armed) drag.slots = slotRects(drag.fromIdx);
          });
        }
      }
      drag.slots = slotRects(drag.fromIdx);
      const onto = mergeSlotAt(y, drag.slots);
      cards().forEach(c => c.classList.remove('ss-target'));
      if (onto) {
        onto.el.classList.add('ss-target');
        drag.mergeIdx = onto.idx;
        const line = root.querySelector('.wb-drop-line');
        if (line) line.classList.remove('on');
        if (drag.ghost) drag.ghost.classList.add('ghost--merge');
        return;
      }
      drag.mergeIdx = null;
      if (drag.ghost) drag.ghost.classList.remove('ghost--merge');
      const insertAt = insertionIndex(y, drag.slots);
      drag.lineIdx = insertAt;
      positionLine(insertAt, drag.slots);
    }

    function onPointerUp() {
      if (!drag) return;
      if (drag.armed) {
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 80);
      }
      end(true);
    }

    function onKey(e) {
      if (e.key === 'Escape' && drag) {
        e.preventDefault();
        end(false);
      }
    }

    function onClickCapture(e) {
      if (!suppressClick) return;
      e.stopPropagation();
      e.preventDefault();
    }

    root.addEventListener('pointerdown', onPointerDown);
    addEventListener('pointermove', onPointerMove, { passive: false });
    addEventListener('pointerup', onPointerUp);
    addEventListener('pointercancel', onPointerUp);
    addEventListener('keydown', onKey);
    addEventListener('blur', onPointerUp);
    root.addEventListener('click', onClickCapture, true);
    return () => {
      root.removeEventListener('pointerdown', onPointerDown);
      removeEventListener('pointermove', onPointerMove);
      removeEventListener('pointerup', onPointerUp);
      removeEventListener('pointercancel', onPointerUp);
      removeEventListener('keydown', onKey);
      removeEventListener('blur', onPointerUp);
      root.removeEventListener('click', onClickCapture, true);
      if (drag) end(false);
    };
  }, [listRef, enabled]);
}
