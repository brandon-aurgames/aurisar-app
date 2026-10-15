import React, { memo, useEffect, useRef, useState } from 'react';
import { displayWt } from '../../utils/units';
import { formatPbValue } from '../../utils/formatPbValue';
import { getExerciseHistory } from '../../utils/exerciseHistory';
import Sheet from '../../components/ui/Sheet';
import { SHOW_EXERCISE_PB_DISPLAY } from './showExercisePbDisplay';
import { planEntry } from './planEntry';
import { detailWorkoutEntry, offersAddToWorkout, detailLogArgs } from './detailActions';
import { muscleLabel, equipLabel } from './exerciseFilterOptions';
import { difficultyKey, goalLabelOf, movementLabelOf } from './libraryFacets';
import { illustrationKey } from './illustrationKey';
import { splitInstructions } from './splitInstructions';
import ExerciseGlyph from './ExerciseGlyph';
import { AnatomyFallback } from './AnatomyMaps';

const SWIPE_THRESHOLD = 56;
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const ExerciseDetailSheet = memo(function ExerciseDetailSheet({
  ex,
  setLibDetailEx,
  siblings,
  profile,
  setProfile,
  setAddToWorkoutPicker,
  openSavePlanWizard,
  openQuickLog,
  isInCart, toggleCart,
  allExById,
}) {
  const close = () => setLibDetailEx(null);

  const [turn, setTurn] = useState(null);
  const [subtab, setSubtab] = useState("about");
  const touchStart = useRef(null);
  const sheetRef = useRef(null);

  const idx = ex && siblings ? siblings.findIndex(s => s.id === ex.id) : -1;
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && siblings && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  const goTo = (target, dir) => {
    if (!target) return;
    setTurn(dir === "next" ? "enter-right" : "enter-left");
    setLibDetailEx(target);
  };

  useEffect(() => {
    if (!ex) return undefined;
    const onKey = e => {
      if (e.key === "ArrowRight") { e.preventDefault(); goTo(next, "next"); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goTo(prev, "prev"); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex && ex.id, prev && prev.id, next && next.id]);

  const wasOpen = useRef(false);
  useEffect(() => {
    const open = ex != null;
    if (open && !wasOpen.current) {
      const first = sheetRef.current?.querySelector("[data-sheet-prev]") || sheetRef.current;
      first?.focus?.();
      setSubtab("about");
    }
    wasOpen.current = open;
  }, [ex]);

  if (!ex) return null;

  const isFav = (profile.favoriteExercises || []).includes(ex.id);
  const pb = (profile.exercisePBs || {})[ex.id];
  const showPb = SHOW_EXERCISE_PB_DISPLAY && !!pb;
  const history = getExerciseHistory(profile.log, ex.id);
  const sessions = history.length;
  const instructions = splitInstructions(ex.desc);
  const hasGlyph = !!illustrationKey(ex.name);
  const movement = movementLabelOf(ex);
  const goal = goalLabelOf(ex);
  const diff = difficultyKey(ex);
  const mgLabel = ex.muscleGroup ? muscleLabel(ex.muscleGroup) : "";

  const onTouchStart = e => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = e => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
    goTo(dx < 0 ? next : prev, dx < 0 ? "next" : "prev");
  };

  const trapTab = e => {
    if (e.key !== "Tab") return;
    const root = sheetRef.current;
    if (!root) return;
    const nodes = [...root.querySelectorAll(FOCUSABLE)].filter(el => !el.hasAttribute("disabled"));
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const histVals = history.map(h => (h.weightLbs != null ? h.weightLbs : h.xp));
  const histMax = Math.max(...histVals, 1);
  const histMin = Math.min(...histVals, histMax);
  const barH = v => {
    if (histMax === histMin) return 34;
    return Math.round(14 + ((v - histMin) / (histMax - histMin)) * 40);
  };
  const lastRow = history[history.length - 1] || null;

  return (
    <Sheet
      open
      onClose={close}
      layer="detail"
      ariaLabel={ex.name}
      tabIndex={-1}
      sheetRef={sheetRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onAnimationEnd={() => setTurn(null)}
      onKeyDown={trapTab}
      className={`ex-lib-sheet${turn ? ` sheet-${turn}` : ""}`}
      backdropClassName="ex-lib-sheet-backdrop"
      maxWidth={480}
      tall
      showHandle
      showClose={false}
    >
      <div className={`ex-lib-sheet-inner${turn ? ` is-turn-${turn}` : ""}`}>
        <div className="ex-lib-sheet-nav">
          <button type="button" className="ex-lib-nav-pill" data-sheet-prev disabled={!prev} onClick={() => goTo(prev, "prev")} aria-label="Previous exercise">← Prev</button>
          <div className="ex-lib-sheet-counter">
            {idx >= 0 && siblings ? `${idx + 1} / ${siblings.length}` : "1 / 1"}
          </div>
          <button type="button" className="ex-lib-nav-pill" disabled={!next} onClick={() => goTo(next, "next")} aria-label="Next exercise">Next →</button>
          <button type="button" className="ex-lib-icon-btn ex-lib-sheet-close" aria-label="Close" onClick={close}>✕</button>
        </div>

        <div className="ex-lib-sheet-hero">
          <div className="ex-lib-sh-body">
            <div className="ex-lib-sh-cat">{mgLabel}</div>
            <h2 className="ex-lib-sh-name">{ex.name}{showPb && <span className="ex-lib-pb"> {formatPbValue(pb, profile.units)}</span>}</h2>
            <div className="ex-lib-tags">
              <span className="ex-lib-tag is-filled">{diff}</span>
              {ex.equipment && <span className="ex-lib-tag">{equipLabel(ex.equipment)}</span>}
              <span className="ex-lib-tag">{movement}</span>
            </div>
          </div>
          <div className="ex-lib-sh-figure">
            {hasGlyph
              ? <ExerciseGlyph name={ex.name} />
              : <AnatomyFallback muscleGroup={ex.muscleGroup} />}
          </div>
        </div>

        <div className="ex-lib-stats-row">
          <div className="ex-lib-stat">
            <div className="sl">Base XP</div>
            <div className="sv">{ex.baseXP} <span className="accent">xp</span></div>
          </div>
          <div className="ex-lib-stat">
            <div className="sl">Goal</div>
            <div className="sv">{goal || "—"}</div>
          </div>
          <div className="ex-lib-stat">
            <div className="sl">Sessions</div>
            <div className="sv">{sessions}</div>
          </div>
        </div>

        <div className="ex-lib-sheet-tabs" role="tablist" aria-label="Exercise detail">
          <button type="button" role="tab" aria-selected={subtab === "about"} className={subtab === "about" ? "is-on" : ""} onClick={() => setSubtab("about")}>About</button>
          <button type="button" role="tab" aria-selected={subtab === "history"} className={subtab === "history" ? "is-on" : ""} onClick={() => setSubtab("history")}>History</button>
          <span className={`ex-lib-tab-slider${subtab === "history" ? " is-right" : ""}`} aria-hidden="true" />
        </div>

        {subtab === "about" && (
          <div className="ex-lib-desc">
            {instructions.setup || instructions.movement ? (
              <>
                {instructions.setup && <p><strong>Setup.</strong> {instructions.setup}</p>}
                {instructions.movement && <p><strong>Movement.</strong> {instructions.movement}</p>}
              </>
            ) : (
              <p>No description yet.</p>
            )}
          </div>
        )}

        {subtab === "history" && (
          <div className="ex-lib-history">
            {history.length === 0 ? (
              <div className="ex-lib-history-empty">No logs yet. History appears here after you log this exercise.</div>
            ) : (
              <>
                <div className="ex-lib-hist-bars">
                  {history.map((h, i) => {
                    const v = h.weightLbs != null ? h.weightLbs : h.xp;
                    const isLast = i === history.length - 1;
                    const day = h.dateKey ? new Date(h.dateKey + "T12:00:00").toLocaleDateString(undefined, { weekday: "narrow" }) : "·";
                    return (
                      <div key={i} className="ex-lib-hist-col">
                        <span className={isLast ? "is-last" : ""}>{v}</span>
                        <span className="bar" style={{ height: barH(v) }} />
                        <span className="day">{day}</span>
                      </div>
                    );
                  })}
                </div>
                {lastRow && (
                  <div className="ex-lib-hist-last">
                    Last session {lastRow.sets}×{lastRow.reps}
                    {lastRow.weightLbs != null ? ` · ${displayWt(lastRow.weightLbs, profile.units) || ""}` : ""}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="ex-lib-actions-grid">
          <button
            type="button"
            className="ex-lib-primary-btn"
            onClick={() => {
              openQuickLog(ex.id, detailLogArgs(ex));
              close();
            }}
          >Log</button>
          {offersAddToWorkout(ex) && (
            <button
              type="button"
              className="ex-lib-sec-btn"
              onClick={() => {
                setAddToWorkoutPicker({ exercises: [detailWorkoutEntry(ex)] });
                close();
              }}
            >Add to Workout</button>
          )}
          <button
            type="button"
            className="ex-lib-sec-btn"
            onClick={() => {
              openSavePlanWizard([planEntry(ex, profile.chosenClass, allExById)], ex.name, ex.name);
              close();
            }}
          >Add to Plan</button>
          <button
            type="button"
            className={`ex-lib-sec-btn${isFav ? " is-fav" : ""}`}
            aria-pressed={isFav}
            onClick={() => setProfile(p => ({
              ...p,
              favoriteExercises: (p.favoriteExercises || []).includes(ex.id)
                ? (p.favoriteExercises || []).filter(i => i !== ex.id)
                : [...(p.favoriteExercises || []), ex.id]
            }))}
          >{isFav ? "Favorited" : "Favorite"}</button>
        </div>
      </div>
    </Sheet>
  );
});

export default ExerciseDetailSheet;
