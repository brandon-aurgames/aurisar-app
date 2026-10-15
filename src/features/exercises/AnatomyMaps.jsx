import React, { memo, useCallback } from 'react';
import { isRegionSelected, muscleForRegion } from './anatomyRegions';
import { muscleLabel } from './exerciseFilterOptions';

function onMuscleKey(e, onSelect, mg) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    onSelect(mg);
  }
}

const FrontFigure = memo(function FrontFigure({ selectedMuscle, onSelect, counts, interactive = true }) {
  const on = r => isRegionSelected(r, selectedMuscle);
  const wrap = (region, paths) => {
    const mg = muscleForRegion(region);
    const count = counts?.get?.(mg);
    const selected = on(region);
    const label = muscleLabel(mg);
    const countBit = typeof count === "number" ? `, ${count} exercise${count === 1 ? "" : "s"}` : "";
    return (
      <g
        className={`ex-lib-muscle${selected ? " is-on" : ""}`}
        role={interactive ? "button" : "presentation"}
        tabIndex={interactive ? 0 : undefined}
        aria-pressed={interactive ? selected : undefined}
        aria-label={interactive ? `${label}${countBit}. Front view` : undefined}
        data-region={region}
        data-muscle={mg}
        onClick={interactive ? () => onSelect(mg) : undefined}
        onKeyDown={interactive ? e => onMuscleKey(e, onSelect, mg) : undefined}
      >
        {paths}
      </g>
    );
  };
  return (
    <svg viewBox="0 0 140 300" className="ex-lib-anatomy-fig" preserveAspectRatio="xMidYMid meet" aria-hidden="false">
      <title>Front anatomy</title>
      <path d="M70,6 C62,6 56,12 56,21 C56,30 62,36 70,36 C78,36 84,30 84,21 C84,12 78,6 70,6 Z" className="ex-lib-body" />
      <path d="M65,35 C65,39 64,42 63,45 L77,45 C76,42 75,39 75,35 Z" className="ex-lib-body" />
      {wrap("traps", (
        <path d="M52,47 C58,42 82,42 88,47 C86,51 84,54 84,54 C76,50 64,50 56,54 C56,54 54,51 52,47 Z" />
      ))}
      {wrap("shoulders", (
        <>
          <path d="M38,52 C42,46 48,48 49,52 C50,56 49,60 47,64 C43,66 39,64 37,60 Z" />
          <path d="M102,52 C98,46 92,48 91,52 C90,56 91,60 93,64 C97,66 101,64 103,60 Z" />
        </>
      ))}
      {wrap("chest", (
        <path d="M48,54 C52,50 68,48 72,48 C76,48 92,50 92,54 C92,58 90,64 88,68 C80,74 60,74 52,68 C50,64 48,58 48,54 Z" />
      ))}
      {wrap("biceps", (
        <>
          <path d="M36,68 C33,68 31,70 31,74 C31,78 31,86 31,92 C31,95 33,96 36,96 C38,96 39,94 39,90 L39,72 C39,69 38,68 36,68 Z" />
          <path d="M104,68 C107,68 109,70 109,74 C109,78 109,86 109,92 C109,95 107,96 104,96 C102,96 101,94 101,90 L101,72 C101,69 102,68 104,68 Z" />
        </>
      ))}
      {wrap("forearms", (
        <>
          <path d="M30,100 C28,100 27,102 27,105 L27,124 C27,128 28,130 31,130 C33,130 34,128 34,126 L34,102 Z" />
          <path d="M110,100 C112,100 113,102 113,105 L113,124 C113,128 112,130 109,130 C107,130 106,128 106,126 L106,102 Z" />
        </>
      ))}
      <ellipse cx="31" cy="137" rx="5" ry="7" className="ex-lib-body" />
      <ellipse cx="109" cy="137" rx="5" ry="7" className="ex-lib-body" />
      {wrap("abs", (
        <>
          <path d="M52,78 C56,74 84,74 88,78 C87,84 86,90 84,96 C78,100 62,100 56,96 C54,90 53,84 52,78 Z" />
          <path d="M48,80 C50,78 52,78 52,80 L52,96 C52,98 50,98 48,96 Z" />
          <path d="M92,80 C90,78 88,78 88,80 L88,96 C88,98 90,98 92,96 Z" />
        </>
      ))}
      <path d="M52,100 C56,96 84,96 88,100 C87,104 86,108 85,110 C78,114 62,114 55,110 C54,108 53,104 52,100 Z" className="ex-lib-body" />
      {wrap("quads", (
        <>
          <path d="M54,114 C50,110 58,108 60,108 L60,168 C60,174 58,178 54,178 C50,178 48,174 48,170 L48,120 Z" />
          <path d="M86,114 C90,110 82,108 80,108 L80,168 C80,174 82,178 86,178 C90,178 92,174 92,170 L92,120 Z" />
        </>
      ))}
      <circle cx="54" cy="186" r="6" className="ex-lib-body" />
      <circle cx="86" cy="186" r="6" className="ex-lib-body" />
      {wrap("calves", (
        <>
          <path d="M46,196 C48,192 54,192 56,196 L56,246 C56,252 54,256 50,256 C46,256 44,252 44,248 L44,200 Z" />
          <path d="M94,196 C92,192 86,192 84,196 L84,246 C84,252 86,256 90,256 C94,256 96,252 96,248 L96,200 Z" />
        </>
      ))}
      <path d="M44,258 L58,258 C58,262 58,266 54,266 L44,266 Z" className="ex-lib-body" />
      <path d="M96,258 L82,258 C82,262 82,266 86,266 L96,266 Z" className="ex-lib-body" />
    </svg>
  );
});

const BackFigure = memo(function BackFigure({ selectedMuscle, onSelect, counts, interactive = true }) {
  const on = r => isRegionSelected(r, selectedMuscle);
  const wrap = (region, paths) => {
    const mg = muscleForRegion(region);
    const count = counts?.get?.(mg);
    const selected = on(region);
    const label = muscleLabel(mg);
    const countBit = typeof count === "number" ? `, ${count} exercise${count === 1 ? "" : "s"}` : "";
    return (
      <g
        className={`ex-lib-muscle${selected ? " is-on" : ""}`}
        role={interactive ? "button" : "presentation"}
        tabIndex={interactive ? 0 : undefined}
        aria-pressed={interactive ? selected : undefined}
        aria-label={interactive ? `${label}${countBit}. Back view` : undefined}
        data-region={region}
        data-muscle={mg}
        onClick={interactive ? () => onSelect(mg) : undefined}
        onKeyDown={interactive ? e => onMuscleKey(e, onSelect, mg) : undefined}
      >
        {paths}
      </g>
    );
  };
  return (
    <svg viewBox="0 0 140 300" className="ex-lib-anatomy-fig" preserveAspectRatio="xMidYMid meet">
      <title>Back anatomy</title>
      <path d="M70,6 C62,6 56,12 56,21 C56,30 62,36 70,36 C78,36 84,30 84,21 C84,12 78,6 70,6 Z" className="ex-lib-body" />
      <path d="M65,35 C65,39 64,42 63,45 L77,45 C76,42 75,39 75,35 Z" className="ex-lib-body" />
      {wrap("traps", (
        <path d="M50,47 C56,42 84,42 90,47 C88,52 86,58 84,60 C76,54 64,54 56,60 C54,58 52,52 50,47 Z" />
      ))}
      {wrap("shoulders", (
        <>
          <path d="M36,54 C40,48 46,50 47,54 C48,58 47,62 45,66 C41,68 37,66 35,62 Z" />
          <path d="M104,54 C100,48 94,50 93,54 C92,58 93,62 95,66 C99,68 103,66 105,62 Z" />
        </>
      ))}
      {wrap("lats", (
        <>
          <path d="M46,62 C50,60 56,62 56,64 L56,90 C56,94 54,96 50,94 C46,92 44,88 44,82 L44,68 Z" />
          <path d="M94,62 C90,60 84,62 84,64 L84,90 C84,94 86,96 90,94 C94,92 96,88 96,82 L96,68 Z" />
        </>
      ))}
      {wrap("triceps", (
        <>
          <path d="M34,70 C31,70 29,72 29,76 C29,80 29,88 29,94 C29,97 31,98 34,98 C36,98 37,96 37,92 L37,74 C37,71 36,70 34,70 Z" />
          <path d="M106,70 C109,70 111,72 111,76 C111,80 111,88 111,94 C111,97 109,98 106,98 C104,98 103,96 103,92 L103,74 C103,71 104,70 106,70 Z" />
        </>
      ))}
      {wrap("forearms", (
        <>
          <path d="M28,104 C26,104 25,106 25,109 L25,128 C25,132 26,134 29,134 C31,134 32,132 32,130 L32,106 Z" />
          <path d="M112,104 C114,104 115,106 115,109 L115,128 C115,132 114,134 111,134 C109,134 108,132 108,130 L108,106 Z" />
        </>
      ))}
      {wrap("lower-back", (
        <path d="M54,96 C58,92 82,92 86,96 C85,100 84,106 83,110 C78,114 62,114 57,110 C56,106 55,100 54,96 Z" />
      ))}
      {wrap("glutes", (
        <path d="M50,118 C54,112 86,112 90,118 C89,124 88,130 87,134 C80,140 60,140 53,134 C52,130 51,124 50,118 Z" />
      ))}
      {wrap("hamstrings", (
        <>
          <path d="M52,140 C50,136 58,134 60,134 L60,182 C60,188 58,192 54,192 C50,192 48,188 48,184 L48,146 Z" />
          <path d="M88,140 C90,136 82,134 80,134 L80,182 C80,188 82,192 86,192 C90,192 92,188 92,184 L92,146 Z" />
        </>
      ))}
      <circle cx="54" cy="198" r="6" className="ex-lib-body" />
      <circle cx="86" cy="198" r="6" className="ex-lib-body" />
      {wrap("calves", (
        <>
          <path d="M46,208 C48,204 54,204 56,208 L56,252 C56,258 54,262 50,262 C46,262 44,258 44,254 L44,212 Z" />
          <path d="M94,208 C92,204 86,204 84,208 L84,252 C84,258 86,262 90,262 C94,262 96,258 96,254 L96,212 Z" />
        </>
      ))}
      <path d="M42,264 L58,264 C58,268 58,272 54,272 L42,272 Z" className="ex-lib-body" />
      <path d="M98,264 L82,264 C82,268 82,272 86,272 L98,272 Z" className="ex-lib-body" />
    </svg>
  );
});

/**
 * Compact front+back figures used as the detail-sheet fallback when there
 * is no movement illustration. Only regions for `highlightMuscle` light up,
 * and posterior regions stay off the front figure.
 */
export function AnatomyFallback({ muscleGroup, className = "" }) {
  return (
    <div className={`ex-lib-fallback-maps ${className}`.trim()} aria-hidden="true">
      <FrontFigure selectedMuscle={muscleGroup} onSelect={() => {}} counts={null} interactive={false} />
      <BackFigure selectedMuscle={muscleGroup} onSelect={() => {}} counts={null} interactive={false} />
    </div>
  );
}

const AnatomyMaps = memo(function AnatomyMaps({
  selectedMuscle,
  onSelect,
  counts,
  toastLabel,
  toastCount,
}) {
  const handleSelect = useCallback(mg => {
    onSelect(mg);
  }, [onSelect]);

  return (
    <div className={`ex-lib-body-maps${selectedMuscle ? " has-selection" : ""}`} role="group" aria-label="Muscle map">
      <div className={`ex-lib-body-map${selectedMuscle ? " is-selected" : ""}`}>
        {toastLabel && (
          <div className="ex-lib-muscle-toast" role="status">
            {toastLabel}
            {typeof toastCount === "number" ? ` · ${toastCount}` : ""}
          </div>
        )}
        <FrontFigure selectedMuscle={selectedMuscle} onSelect={handleSelect} counts={counts} />
        <div className="ex-lib-map-label">Front</div>
      </div>
      <div className={`ex-lib-body-map${selectedMuscle ? " is-selected" : ""}`}>
        <BackFigure selectedMuscle={selectedMuscle} onSelect={handleSelect} counts={counts} />
        <div className="ex-lib-map-label">Back</div>
      </div>
    </div>
  );
});

export default AnatomyMaps;
export { FrontFigure, BackFigure };
