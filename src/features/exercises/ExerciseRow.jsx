import React, { memo } from 'react';
import { getMuscleColor, getTypeColor } from '../../utils/xp';
import { ExIcon } from '../../components/ExIcon';
import { S, R, FS } from '../../utils/tokens';
import { muscleLabel, equipLabel } from './exerciseFilterOptions';
import { DIFF_FG, DIFF_BG } from './difficulty';
import { SHOW_EXERCISE_PB_DISPLAY } from './showExercisePbDisplay';

/**
 * Shared exercise row — Library, My Exercises, and the workout-builder picker.
 *
 * Library / My Exercises pass onToggleSelect for a always-on checkbox; the
 * row body still opens detail. The picker keeps tap-to-select via selectable
 * + onActivate and does not show a checkbox.
 */

function difficultyOf(ex) {
  return ex.difficulty || (ex.baseXP >= 60 ? "Advanced" : ex.baseXP >= 45 ? "Intermediate" : "Beginner");
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const TOOL_PRESS = '.ex-row-check, .picker-ex-fav, .ex-row-icon-btn';

function suppressRowPress(e) {
  if (!e.target.closest?.(TOOL_PRESS)) return;
  const row = e.currentTarget;
  row.classList.add('no-row-press');
  const clear = () => {
    row.classList.remove('no-row-press');
    window.removeEventListener('pointerup', clear, true);
    window.removeEventListener('pointercancel', clear, true);
  };
  window.addEventListener('pointerup', clear, true);
  window.addEventListener('pointercancel', clear, true);
}

const ExerciseRow = memo(function ExerciseRow({
  ex,
  onActivate,
  selected = false,
  selectable = false,
  onToggleSelect,
  showEquipment = false,
  showPB = false,
  showCustomBadge = false,
  isFav,
  onToggleFav,
  trailing,
  style,
  rowRef,
  className = "",
  ...rest
}) {
  const diffLabel = difficultyOf(ex);
  const mg = getMuscleColor(ex.muscleGroup);
  const showPbBadge = SHOW_EXERCISE_PB_DISPLAY && showPB;

  const label = [
    ex.name,
    showPbBadge ? 'personal best' : null,
    ex.category && cap(ex.category),
    ex.muscleGroup && muscleLabel(ex.muscleGroup),
    showEquipment && ex.equipment && ex.equipment !== "bodyweight" ? equipLabel(ex.equipment) : null,
    `${ex.baseXP} XP`,
    diffLabel,
  ].filter(Boolean).join(', ');

  return (
    <div
      ref={rowRef}
      className={`picker-ex-row stretch-row${selected ? " sel" : ""}${className ? " " + className : ""}`}
      style={{ ...style, "--mg-color": mg }}
      {...rest}
      onPointerDown={e => {
        rest.onPointerDown?.(e);
        suppressRowPress(e);
      }}
    >
      {onToggleSelect && (
        <button
          type="button"
          role="checkbox"
          className={`ex-row-check${selected ? " on" : ""}`}
          aria-checked={!!selected}
          aria-label={selected ? `Remove ${ex.name} from selection` : `Add ${ex.name} to selection`}
          onClick={e => { e.stopPropagation(); onToggleSelect(ex.id); }}
        >{selected ? "✓" : ""}</button>
      )}

      <div className={"picker-ex-orb"}><ExIcon ex={ex} size={"1.15rem"} color={"#e8e2d6"} /></div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: S.s6,
          flexWrap: "wrap",
          marginBottom: S.s4
        }}>
          <button
            type="button"
            className={"picker-ex-main"}
            aria-label={label}
            aria-pressed={selectable ? selected : undefined}
            onClick={onActivate}
            style={{
              fontSize: FS.fs83,
              fontWeight: 600,
              color: "#ece6da",
              letterSpacing: ".005em"
            }}
          >{ex.name}</button>
          {showPbBadge && <span aria-hidden="true" style={{ fontSize: FS.sm }}>{"🏆"}</span>}
          {showCustomBadge && ex.custom && (
            <span className={"custom-ex-badge"} style={{ marginLeft: S.s4 }}>{"custom"}</span>
          )}
        </div>

        <div className={"picker-ex-meta"} aria-hidden="true" style={{ fontSize: FS.fs62, fontStyle: "italic", lineHeight: 1.4 }}>
          {ex.category && <span style={{ color: getTypeColor(ex.category) }}>{cap(ex.category)}</span>}
          {ex.category && ex.muscleGroup && <span style={{ color: "#8a8478" }}>{" · "}</span>}
          {ex.muscleGroup && <span style={{ color: mg }}>{muscleLabel(ex.muscleGroup)}</span>}
          {showEquipment && ex.equipment && ex.equipment !== "bodyweight" && <>
            <span style={{ color: "#8a8478" }}>{" · "}</span>
            <span style={{ color: "#8a8478" }}>{equipLabel(ex.equipment)}</span>
          </>}
        </div>
      </div>

      <div style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: S.s6
      }}>
        <span className={"picker-ex-xp"} aria-hidden="true">{ex.baseXP + " XP"}</span>

        <span aria-hidden="true" style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "2px 8px",
          borderRadius: R.r4,
          fontSize: FS.fs58,
          fontWeight: 700,
          letterSpacing: ".05em",
          color: DIFF_FG[diffLabel] || DIFF_FG.Intermediate,
          background: DIFF_BG[diffLabel] || DIFF_BG.Intermediate
        }}>{diffLabel}</span>

        {trailing}

        {onToggleFav && (
          <button
            type="button"
            className={"picker-ex-fav"}
            aria-pressed={!!isFav}
            aria-label={isFav ? `Remove ${ex.name} from favourites` : `Add ${ex.name} to favourites`}
            onClick={e => { e.stopPropagation(); onToggleFav(ex.id); }}
          >{isFav ? "⭐" : "☆"}</button>
        )}
      </div>
    </div>
  );
});

export default ExerciseRow;
