import React, { memo } from 'react';
import { equipLabel, muscleLabel } from './exerciseFilterOptions';
import { difficultyKey, goalLabelOf, movementLabelOf } from './libraryFacets';
import { illustrationKey } from './illustrationKey';
import EquipIcon from './EquipIcons';
import ExerciseGlyph from './ExerciseGlyph';

function StarIcon({ on }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 17.2 6.8 19.6l1-5.8-4.2-4.1 5.8-.8z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="ex-lib-plus" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="ex-lib-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export function libraryCardLabel(ex, { selected, isFav } = {}) {
  return [
    `Open details for ${ex.name}`,
    selected ? "added" : null,
    isFav ? "favorited" : null,
  ].filter(Boolean).join(", ");
}

const LibraryExerciseCard = memo(function LibraryExerciseCard({
  ex,
  selected = false,
  isFav = false,
  variant = "result",
  onOpen,
  onToggleFav,
  onToggleSelect,
}) {
  const xp = ex.baseXP;
  const equip = equipLabel(ex.equipment || "bodyweight");
  const diff = difficultyKey(ex);
  const movement = movementLabelOf(ex);
  const goal = goalLabelOf(ex);
  const hasGlyph = !!illustrationKey(ex.name);
  const label = libraryCardLabel(ex, { selected, isFav });

  const open = e => {
    e?.preventDefault?.();
    onOpen?.(ex);
  };
  const onKey = e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen?.(ex);
    }
  };

  return (
    <div
      className={`ex-lib-card ex-lib-card--${variant}${selected ? " is-selected" : ""}${isFav ? " is-fav" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={open}
      onKeyDown={onKey}
    >
      <div className="ex-lib-card-thumb" aria-hidden="true">
        {hasGlyph && variant === "result"
          ? <ExerciseGlyph name={ex.name} />
          : <EquipIcon equipment={ex.equipment} size={variant === "result" ? 22 : 18} />}
      </div>
      <div className="ex-lib-card-body">
        <div className="ex-lib-card-title">
          <span className="ex-lib-card-name">{ex.name}</span>
          {xp != null && <span className="ex-lib-xp">{xp} XP</span>}
        </div>
        <div className="ex-lib-card-meta">
          <span>{equip}</span>
          <span className="ex-lib-dot" />
          <span>{diff}</span>
          <span className="ex-lib-dot" />
          <span className="ex-lib-meta-accent">{movement}</span>
          {goal && <>
            <span className="ex-lib-dot" />
            <span>{goal}</span>
          </>}
          {ex.muscleGroup && variant === "recent" && <>
            <span className="ex-lib-dot" />
            <span>{muscleLabel(ex.muscleGroup)}</span>
          </>}
        </div>
      </div>
      <div className="ex-lib-card-actions">
        {onToggleFav && (
          <button
            type="button"
            className={`ex-lib-action-circle${isFav ? " is-on star" : ""}`}
            aria-pressed={!!isFav}
            aria-label={isFav ? `Remove ${ex.name} from favorites` : `Add ${ex.name} to favorites`}
            onClick={e => { e.stopPropagation(); onToggleFav(ex.id); }}
          >
            <StarIcon on={isFav} />
          </button>
        )}
        {onToggleSelect && (
          <button
            type="button"
            className={`ex-lib-action-circle add${selected ? " is-on" : ""}`}
            aria-pressed={!!selected}
            aria-label={selected ? `Remove ${ex.name} from selection` : `Add ${ex.name} to selection`}
            onClick={e => { e.stopPropagation(); onToggleSelect(ex.id); }}
          >
            <PlusIcon />
            <CheckIcon />
          </button>
        )}
      </div>
    </div>
  );
});

export default LibraryExerciseCard;
