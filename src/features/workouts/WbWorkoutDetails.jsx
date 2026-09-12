import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalLifecycle } from '../../utils/useModalLifecycle';
import { normalizeHHMM } from '../../utils/time';
import { FS, S, Z } from '../../utils/tokens';

/**
 * Workout Details trigger + full-screen overlay.
 * Idle: narrow smoked-glass tab on the left edge.
 * Hover (fine pointer): the handle expands; tap/click opens the overlay.
 * Touch skips hover and opens on the first tap.
 */
export function WbDetailsTrigger({ open, filled, onOpen }) {
  const [paused, setPaused] = useState(false);
  const [opening, setOpening] = useState(false);
  const [hovered, setHovered] = useState(false);
  const openTimer = useRef(null);

  useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
  }, []);

  useEffect(() => {
    setHovered(false);
  }, [open]);

  const chargeAndOpen = () => {
    if (openTimer.current) return;
    setOpening(true);
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setOpening(false);
      onOpen();
    }, 140);
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <button
      type="button"
      className={`wb-dt${filled ? ' is-filled' : ''}${opening ? ' is-opening' : ''}${hovered ? ' is-hover' : ''}${paused ? ' is-paused' : ''}${open ? ' is-open' : ''}`}
      onPointerEnter={e => { if (e.pointerType !== 'touch') setHovered(true); }}
      onPointerLeave={() => setHovered(false)}
      onClick={chargeAndOpen}
      disabled={open || opening}
      inert={open}
      aria-hidden={open || undefined}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="wb-details-overlay"
      aria-label="Open workout details"
    >
      <span className="wb-dt-tab" aria-hidden="true">
        <span className="wb-dt-glow" />
        <span className="wb-dt-ember wb-dt-ember-a" />
        <span className="wb-dt-ember wb-dt-ember-b" />
        <span className="wb-dt-label-idle">DETAILS</span>
        <span className="wb-dt-label-hover">DETAILS<span className="wb-dt-chevron">›</span></span>
      </span>
    </button>,
    document.body
  );
}

export function WbDetailsOverlay({
  open,
  onClose,
  wbName, setWbName,
  wbDesc, setWbDesc,
  wbLabels, setWbLabels,
  newLabelInput, setNewLabelInput,
  profile, setProfile,
  wbDuration, setWbDuration, setWbDurSec,
  wbActiveCal, setWbActiveCal,
  wbTotalCal, setWbTotalCal,
  wbExercises,
  allExById,
}) {
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const [paused, setPaused] = useState(false);
  const [shown, setShown] = useState(!!open);
  const [closing, setClosing] = useState(false);

  useModalLifecycle(!!open, onClose, backdropRef);

  useEffect(() => {
    if (open) {
      setShown(true);
      setClosing(false);
      return undefined;
    }
    if (!shown) return undefined;
    setClosing(true);
    const reduce = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setShown(false);
      setClosing(false);
      return undefined;
    }
    const t = window.setTimeout(() => {
      setShown(false);
      setClosing(false);
    }, 360);
    return () => window.clearTimeout(t);
  }, [open, shown]);

  useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const id = requestAnimationFrame(() => {
      const el = dialogRef.current;
      if (el && !el.contains(document.activeElement)) el.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  if (!shown) return null;

  const addLabel = () => {
    const lbl = newLabelInput.trim();
    if (!lbl) return;
    if (!(profile.workoutLabels || []).some(x => x.toLowerCase() === lbl.toLowerCase())) {
      setProfile(p => ({ ...p, workoutLabels: [...(p.workoutLabels || []), lbl] }));
    }
    if (!wbLabels.includes(lbl)) setWbLabels(prev => [...prev, lbl]);
    setNewLabelInput('');
  };

  return createPortal(
    <div
      ref={backdropRef}
      className={`wb-details-overlay${closing ? ' is-closing' : ''}${paused ? ' is-paused' : ''}`}
      style={{ zIndex: Z.modal }}
      role="presentation"
    >
      <div className="wb-details-sweep" aria-hidden="true">
        <span className="wb-details-sweep-heat" />
        <span className="wb-details-sweep-smoke" />
        <span className="wb-details-sweep-ember e1" />
        <span className="wb-details-sweep-ember e2" />
        <span className="wb-details-sweep-ember e3" />
        <span className="wb-details-sweep-ember e4" />
      </div>
      <div className="wb-details-atmos" aria-hidden="true">
        <span className="wb-details-atmos-p p1" />
        <span className="wb-details-atmos-p p2" />
        <span className="wb-details-atmos-p p3" />
      </div>
      <div
        ref={dialogRef}
        id="wb-details-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wb-details-title"
        tabIndex={-1}
        className="wb-details-panel"
      >
        <div className="wb-details-panel-hdr">
          <div>
            <h2 id="wb-details-title" className="wb-details-title">Workout Details</h2>
            <p className="wb-details-sub">Configure this session</p>
          </div>
          <button type="button" className="wb-details-close" aria-label="Close workout details" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="wb-details-panel-body">
          <section className="wb-details-card">
            <label htmlFor="wb-details-name">Workout name</label>
            <input
              id="wb-details-name"
              className="inp"
              value={wbName}
              onChange={e => setWbName(e.target.value)}
              placeholder="e.g. Morning Push Day…"
            />
          </section>

          <section className="wb-details-card">
            <div className="wb-details-card-kicker">Exercises</div>
            {wbExercises.length === 0 ? (
              <p className="wb-details-empty">None added yet. Add them on the builder canvas.</p>
            ) : (
              <ul className="wb-details-ex-list">
                {wbExercises.map((ex, i) => {
                  const d = allExById[ex.exId];
                  if (!d) return null;
                  const isTimed = d.category === 'cardio' || d.category === 'flexibility';
                  return (
                    <li key={`${ex.exId}_${i}`}>
                      <span className="wb-details-ex-name">{d.name}</span>
                      <span className="wb-details-ex-meta">
                        {ex.sets || 3}×{ex.reps || 10}{isTimed ? ' min' : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="wb-details-card">
            <label htmlFor="wb-details-notes">Notes</label>
            <textarea
              id="wb-details-notes"
              className="inp wb-details-notes"
              rows={3}
              value={wbDesc}
              onChange={e => setWbDesc(e.target.value)}
              placeholder="e.g. Upper body strength focus…"
            />
          </section>

          <section className="wb-details-card">
            <div className="wb-details-card-kicker">Labels <span>(optional)</span></div>
            <div className="wb-details-labels">
              {(profile.workoutLabels || []).map(l => (
                <span
                  key={l}
                  className={'wo-label-chip' + (wbLabels.includes(l) ? ' sel' : '')}
                  onClick={() => setWbLabels(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l])}
                >
                  {l}
                </span>
              ))}
              <span className="wb-details-label-new">
                <input
                  className="wo-label-new-inp"
                  value={newLabelInput}
                  onChange={e => setNewLabelInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addLabel(); }}
                  placeholder="+ New label…"
                  style={{ width: 100 }}
                />
                <button type="button" className="btn btn-ghost btn-xs" style={{ padding: '2px 6px', fontSize: FS.sm }} onClick={addLabel}>+</button>
              </span>
            </div>
          </section>

          <section className="wb-details-card">
            <div className="wb-details-card-kicker">Session stats <span>(optional)</span></div>
            <div className="wb-stats-row">
              <div className="field" style={{ marginBottom: S.s0 }}>
                <label htmlFor="wb-details-dur">Duration</label>
                <input
                  id="wb-details-dur"
                  className="inp"
                  type="text"
                  inputMode="numeric"
                  value={wbDuration}
                  onChange={e => setWbDuration(e.target.value)}
                  onBlur={e => {
                    const val = e.target.value.trim();
                    if (!val) { setWbDuration(''); setWbDurSec(''); return; }
                    const hms = val.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
                    if (hms) {
                      const h = Number(hms[1]); const m = Number(hms[2]); const s = Number(hms[3]);
                      const ss = Math.min(s, 59);
                      setWbDuration(`${String(h + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(ss).padStart(2, '0')}`);
                      setWbDurSec('');
                    } else {
                      setWbDuration(normalizeHHMM(val));
                      setWbDurSec('');
                    }
                  }}
                  placeholder="HH:MM[:SS]"
                  style={{ textAlign: 'center' }}
                />
                <div className="wb-dur-hint">90 = 1h30m · include :SS for seconds</div>
              </div>
              <div className="wb-cal-fields">
                <div className="field" style={{ marginBottom: S.s0 }}>
                  <label htmlFor="wb-details-cal-a">Active Cal</label>
                  <input id="wb-details-cal-a" className="inp" type="number" min="0" max="9999" value={wbActiveCal} onChange={e => setWbActiveCal(e.target.value)} />
                </div>
                <div className="field" style={{ marginBottom: S.s0 }}>
                  <label htmlFor="wb-details-cal-t">Total Cal</label>
                  <input id="wb-details-cal-t" className="inp" type="number" min="0" max="9999" value={wbTotalCal} onChange={e => setWbTotalCal(e.target.value)} />
                </div>
              </div>
            </div>
          </section>
        </div>
        <div className="wb-details-panel-footer">
          <button type="button" className="wb-details-done" onClick={onClose}>Save details</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
