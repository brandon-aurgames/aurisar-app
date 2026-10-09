import React, { memo } from 'react';
import { getMuscleColor } from '../../utils/xp';
import { ExIcon } from '../../components/ExIcon';
import { muscleLabel, equipLabel } from './exerciseFilterOptions';
import { SHOW_EXERCISE_PB_DISPLAY } from './showExercisePbDisplay';
import ExRowOverflowMenu from './ExRowOverflowMenu';

/**
 * Shared exercise row — Library, My Exercises, and the workout-builder picker.
 *
 * Compact (~56px): checkbox, icon, one-line name, muted muscle · equipment,
 * favourite star. Difficulty / XP / type stay in the accessible name, not as
 * chips. Library / My Exercises pass onToggleSelect; the row body still opens
 * detail. The picker uses selectable + onActivate and has no checkbox.
 */

export function difficultyOf(ex) {
  return ex.difficulty || (ex.baseXP >= 60 ? "Advanced" : ex.baseXP >= 45 ? "Intermediate" : "Beginner");
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const TOOL_PRESS = '.ex-row-check, .picker-ex-fav, .ex-row-icon-btn, .ex-row-more';

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

/** Accessible name: visual chips are gone, but AT still hears type/muscle/equip/difficulty. */
export function exerciseRowLabel(ex, { showPB = false } = {}) {
  const showPbBadge = SHOW_EXERCISE_PB_DISPLAY && showPB;
  return [
    ex.name,
    showPbBadge ? 'personal best' : null,
    ex.custom ? 'Custom' : null,
    ex.category && cap(ex.category),
    ex.muscleGroup && muscleLabel(ex.muscleGroup),
    ex.equipment ? equipLabel(ex.equipment) : null,
    difficultyOf(ex),
  ].filter(Boolean).join(', ');
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
  onEdit,
  onDuplicate,
  onDelete,
  trailing,
  style,
  rowRef,
  className = "",
  ...rest
}) {
  const mg = getMuscleColor(ex.muscleGroup);
  const showPbBadge = SHOW_EXERCISE_PB_DISPLAY && showPB;
  const label = exerciseRowLabel(ex, { showPB });
  const metaBits = [
    ex.custom ? "Custom" : null,
    ex.muscleGroup ? muscleLabel(ex.muscleGroup) : null,
    (showEquipment || !!ex.equipment) && ex.equipment ? equipLabel(ex.equipment) : null,
  ].filter(Boolean);

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
        >
          <span className={"ex-row-check-box"} aria-hidden="true">{selected ? "✓" : ""}</span>
        </button>
      )}

      <div className={"picker-ex-orb"}><ExIcon ex={ex} size={"0.9rem"} color={"#e8e2d6"} /></div>

      <div className={"picker-ex-copy"}>
        <div className={"picker-ex-name-row"}>
          <button
            type="button"
            className={"picker-ex-main"}
            aria-label={label}
            aria-pressed={selectable ? selected : undefined}
            onClick={onActivate}
          >{ex.name}</button>
          {showPbBadge && <span className={"picker-ex-pb"} aria-hidden="true">{"🏆"}</span>}
        </div>
        <div className={"picker-ex-meta"} aria-hidden="true">
          {metaBits.join(" · ")}
        </div>
      </div>

      {(onEdit || onDuplicate || onDelete) && (
        <ExRowOverflowMenu
          name={ex.name}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      )}

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
  );
});

export default ExerciseRow;
