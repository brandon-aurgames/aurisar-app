import React, { useEffect, useMemo, useRef, useState } from 'react';
import { S, R, FS, Z } from '../../utils/tokens';
import Sheet from '../../components/ui/Sheet';

const STEEL = "#B0A898";
const NARROW_MQ = "(max-width: 520px)";

function useNarrowFilters() {
  const [narrow, setNarrow] = useState(() => (
    typeof window !== "undefined" && !!window.matchMedia?.(NARROW_MQ)?.matches
  ));
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW_MQ);
    if (!mq) return undefined;
    const on = () => setNarrow(mq.matches);
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", on);
      return () => mq.removeEventListener("change", on);
    }
    if (typeof mq.addListener === "function") {
      mq.addListener(on);
      return () => mq.removeListener(on);
    }
    return undefined;
  }, []);
  return narrow;
}

/**
 * Multi-select filter. Desktop: dropdown listbox. Narrow viewports: bottom
 * Sheet so the options sit in the thumb zone instead of a clipped panel.
 */
function FilterDropdown({
  id,
  label,
  shortLabel,
  options,
  optionLabel,
  selected,
  counts,
  onToggle,
  open,
  setOpen,
  accent = STEEL,
  optionAccent,
  panelBorder = "rgba(180,172,158,.14)",
  footer,
}) {
  const [activeIdx, setActiveIdx] = useState(-1);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const optionRefs = useRef([]);
  const narrow = useNarrowFilters();

  const enabled = useMemo(
    () => options.map(v => selected.has(v) || (counts.get(v) || 0) > 0),
    [options, selected, counts]
  );

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const firstSel = options.findIndex(v => selected.has(v));
      setActiveIdx(firstSel >= 0 ? firstSel : enabled.findIndex(Boolean));
    } else {
      setActiveIdx(-1);
    }
  }

  useEffect(() => {
    if (open && !narrow) listRef.current?.focus();
  }, [open, narrow]);

  useEffect(() => {
    if (open && activeIdx >= 0) optionRefs.current[activeIdx]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIdx]);

  const step = dir => {
    if (!enabled.some(Boolean)) return;
    let i = activeIdx;
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length;
      if (enabled[i]) { setActiveIdx(i); return; }
    }
  };

  const onTriggerKey = e => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(id);
    }
  };

  const onListKey = e => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); step(1); break;
      case 'ArrowUp': e.preventDefault(); step(-1); break;
      case 'Home': e.preventDefault(); setActiveIdx(enabled.findIndex(Boolean)); break;
      case 'End': e.preventDefault(); setActiveIdx(enabled.lastIndexOf(true)); break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (activeIdx >= 0 && enabled[activeIdx]) onToggle(options[activeIdx]);
        break;
      case 'Escape':
      case 'Tab':
        if (e.key === 'Escape') e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); triggerRef.current?.focus(); }
        setOpen(null);
        break;
      default: break;
    }
  };

  const count = selected.size;
  const triggerColor = count > 0 ? STEEL : "#8a8478";

  const optionRow = (val, i) => {
    const sel = selected.has(val);
    const isEnabled = enabled[i];
    const n = counts.get(val) || 0;
    const tint = optionAccent ? optionAccent(val) : accent;
    const isActive = i === activeIdx;
    return (
      <div
        key={val}
        id={`${id}-opt-${i}`}
        ref={el => { optionRefs.current[i] = el; }}
        role="option"
        tabIndex={-1}
        aria-selected={sel}
        aria-disabled={!isEnabled}
        onClick={() => isEnabled && onToggle(val)}
        onMouseEnter={() => isEnabled && setActiveIdx(i)}
        className={"lib-filter-opt"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: S.s8,
          padding: narrow ? "12px 10px" : "6px 10px",
          minHeight: 44,
          borderRadius: R.md,
          cursor: isEnabled ? "pointer" : "default",
          opacity: isEnabled ? 1 : 0.35,
          background: sel
            ? `color-mix(in srgb, ${tint} 14%, transparent)`
            : isActive ? "rgba(45,42,36,.28)" : "transparent",
          boxShadow: isActive ? `inset 0 0 0 1px color-mix(in srgb, ${tint} 30%, transparent)` : "none",
        }}
      >
        <div aria-hidden="true" style={{
          width: 14,
          height: 14,
          borderRadius: R.r3,
          flexShrink: 0,
          border: "1.5px solid " + (sel ? tint : "rgba(180,172,158,.18)"),
          background: sel ? `color-mix(in srgb, ${tint} 25%, transparent)` : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}>
          {sel && <span style={{ fontSize: FS.sm, color: tint, lineHeight: 1 }}>{"✓"}</span>}
        </div>
        <span style={{
          fontSize: FS.lg,
          color: sel ? tint : isEnabled ? "#b4ac9e" : "#8a8478",
          whiteSpace: "nowrap",
          flex: 1
        }}>{optionLabel(val)}</span>
        <span style={{
          fontSize: FS.fs60,
          color: isEnabled ? "#6f6a62" : "#4a463f",
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0
        }}>{n}</span>
      </div>
    );
  };

  const listboxProps = {
    id: `${id}-listbox`,
    role: "listbox",
    "aria-multiselectable": "true",
    "aria-label": label,
    "aria-activedescendant": activeIdx >= 0 ? `${id}-opt-${activeIdx}` : undefined,
    tabIndex: -1,
    onKeyDown: onListKey,
  };

  return (
    <div style={{ position: "relative", flex: "1 1 110px", zIndex: Z.dropdown }}>
      <button
        ref={triggerRef}
        type="button"
        className={"lib-filter-trigger"}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onClick={() => setOpen(open ? null : id)}
        onKeyDown={onTriggerKey}
        style={{
          width: "100%",
          minHeight: 44,
          padding: "8px 28px 8px 10px",
          borderRadius: R.xl,
          border: "1px solid " + (count > 0 ? "rgba(180,172,158,.35)" : "rgba(45,42,36,.3)"),
          background: "rgba(14,14,12,.95)",
          color: triggerColor,
          fontSize: FS.lg,
          textAlign: "left",
          cursor: "pointer",
          position: "relative"
        }}
      >
        {count > 0 ? `${shortLabel} (${count})` : label}
        <span aria-hidden="true" style={{
          position: "absolute",
          right: 8,
          top: "50%",
          transform: `translateY(-50%) rotate(${open ? "180deg" : "0deg"})`,
          color: triggerColor,
          fontSize: FS.sm,
          transition: "transform var(--dur-fast) var(--ease-standard)",
          lineHeight: 1
        }}>{"▼"}</span>
      </button>

      {open && narrow && (
        <Sheet
          open
          onClose={() => setOpen(null)}
          layer={"modal"}
          title={label}
          ariaLabel={label}
          footer={
            <button type="button" className={"btn btn-gold-solid"} style={{ width: "100%" }} onClick={() => setOpen(null)}>
              {"Done"}
            </button>
          }
        >
          <div ref={listRef} {...listboxProps}>
            {options.map(optionRow)}
            {footer}
          </div>
        </Sheet>
      )}

      {open && !narrow && <div
        ref={listRef}
        {...listboxProps}
        style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          minWidth: "100%",
          maxHeight: 260,
          overflowY: "auto",
          background: "rgba(16,14,10,.95)",
          border: `1px solid ${panelBorder}`,
          borderRadius: R.xl,
          padding: "6px 4px",
          zIndex: Z.dropdown + 1,
          boxShadow: "0 8px 24px rgba(0,0,0,.6)",
          outline: "none"
        }}
      >
        {options.map(optionRow)}
        {footer}
      </div>}
    </div>
  );
}

export default React.memo(FilterDropdown);
