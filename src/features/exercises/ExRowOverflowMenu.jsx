import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * ⋯ overflow for custom ExerciseRows. Portaled so the 52px overflow:hidden
 * card cannot clip the menu. Keyboard matches the workout-builder overflow:
 * focus the first item on open, arrows cycle, Escape closes and returns
 * focus to the trigger.
 */
export default function ExRowOverflowMenu({
  name,
  onEdit,
  onDuplicate,
  onDelete,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const menu = menuRef.current;
    const items = () => [...(menu?.querySelectorAll('[role="menuitem"]:not(:disabled)') ?? [])];
    items()[0]?.focus();
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      const enabled = items();
      if (!enabled.length) return;
      const i = Math.max(0, enabled.indexOf(document.activeElement));
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        enabled[(i + dir + enabled.length) % enabled.length]?.focus();
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        enabled[0]?.focus();
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        enabled.at(-1)?.focus();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const dir = e.shiftKey ? -1 : 1;
        enabled[(i + dir + enabled.length) % enabled.length]?.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  function close({ restore = false } = {}) {
    setOpen(false);
    if (restore) triggerRef.current?.focus();
  }

  return (
    <div className={"ex-row-overflow"}>
      <button
        ref={triggerRef}
        type="button"
        className={"ex-row-more"}
        aria-label={`More actions for ${name}`}
        aria-haspopup={"menu"}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={e => {
          e.stopPropagation();
          setOpen(v => !v);
        }}
      >{"⋯"}</button>
      {open && createPortal(
        <>
          <div
            className={"ex-row-menu-scrim"}
            onClick={e => { e.stopPropagation(); close({ restore: true }); }}
          />
          <div
            ref={menuRef}
            id={menuId}
            className={"ex-row-menu"}
            role={"menu"}
            style={{ top: pos.top, right: pos.right }}
          >
            {onEdit && (
              <button
                type="button"
                role="menuitem"
                onClick={e => { e.stopPropagation(); onEdit(); close(); }}
              >{"Edit"}</button>
            )}
            {onDuplicate && (
              <button
                type="button"
                role="menuitem"
                onClick={e => { e.stopPropagation(); onDuplicate(); close(); }}
              >{"Duplicate"}</button>
            )}
            {onDelete && (
              <button
                type="button"
                role="menuitem"
                className={"danger"}
                onClick={e => { e.stopPropagation(); onDelete(); close(); }}
              >{"Delete"}</button>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
