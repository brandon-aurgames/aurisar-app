import React, { memo, useCallback, useDeferredValue, useMemo } from 'react';
import { List } from 'react-window';
import { UI_COLORS } from '../../data/constants';
import { getMuscleColor, getTypeColor } from '../../utils/xp';
import { ExIcon } from '../../components/ExIcon';
import { S, FS } from '../../utils/tokens';
import Sheet from '../../components/ui/Sheet';
import ExerciseRow from '../exercises/ExerciseRow';
import FilterDropdown from '../exercises/FilterDropdown';
import { matchesAll, facetCounts as countFacet, NO_FACET, muscleKeys, typeKeys, equipKeys } from '../exercises/matchesFacets';
import {
  TYPE_OPTS, TYPE_LABELS, MUSCLE_OPTS, EQUIP_OPTS, muscleLabel, equipLabel,
} from '../exercises/exerciseFilterOptions';

// Module scope so the memo'd FilterDropdown sees a stable optionLabel.
const typeLabel = v => TYPE_LABELS[v];

/**
 * Workout exercise picker modal — extracted from the inline block in App.jsx
 * as part of Finding #6 (App.jsx decomposition) per docs/performance-audit.md
 * (PR #116).
 *
 * Single-pane UI: exercise search/filter list with multi-select Add.
 * Per-exercise configuration happens inline in the workout builder after add.
 * Uses createPortal to render into document.body.
 */

// Row adapter for the virtualised list. The row itself is the shared
// ExerciseRow — this only maps react-window's props onto it. The picker used
// to carry its own hand-written copy that had already drifted from the
// library's.
const WbExPickerRow = React.memo(function WbExPickerRow({
  ariaAttributes, index, style, exercises, selIds, onToggle
}) {
  const ex = exercises[index];
  if (!ex) return null;
  return (
    <div style={{ ...style, paddingTop: 4, paddingBottom: 4 }} {...ariaAttributes}>
      <ExerciseRow
        ex={ex}
        selected={selIds.has(ex.id)}
        selectable
        showCustomBadge
        onActivate={() => onToggle(ex.id)}
      />
    </div>
  );
});

const toggleFilter = (setter, val) => setter(s => {
  const n = new Set(s);
  n.has(val) ? n.delete(val) : n.add(val);
  return n;
});

const WorkoutExercisePicker = memo(function WorkoutExercisePicker({
  // Filter state
  pickerSearch, setPickerSearch,
  pickerMuscle, setPickerMuscle,
  pickerTypeFilter, setPickerTypeFilter,
  pickerEquipFilter, setPickerEquipFilter,
  pickerOpenDrop, setPickerOpenDrop,
  // Selection state
  pickerSelected,
  // Exercise data
  allExercises,
  // Action callbacks
  closePicker,
  openExEditor,
  pickerToggleEx,
  commitPickerToWorkout,
}) {
  const closeDrops = useCallback(() => setPickerOpenDrop(null), [setPickerOpenDrop]);
  const toggleMuscle = useCallback(v => toggleFilter(setPickerMuscle, v), [setPickerMuscle]);
  const toggleType = useCallback(v => toggleFilter(setPickerTypeFilter, v), [setPickerTypeFilter]);
  const toggleEquip = useCallback(v => toggleFilter(setPickerEquipFilter, v), [setPickerEquipFilter]);

  // The input stays bound to pickerSearch (urgent) while the full-catalog
  // scans below run against the deferred value, so a keystroke never waits
  // on three facet passes plus the filter pass over ~1,500 exercises.
  const deferredQ = useDeferredValue(pickerSearch);

  const facetCounts = useMemo(() => ({
    muscle: countFacet(allExercises, muscleKeys, e => matchesAll(e, deferredQ, NO_FACET, pickerTypeFilter, pickerEquipFilter)),
    type: countFacet(allExercises, typeKeys, e => matchesAll(e, deferredQ, pickerMuscle, NO_FACET, pickerEquipFilter)),
    equip: countFacet(allExercises, equipKeys, e => matchesAll(e, deferredQ, pickerMuscle, pickerTypeFilter, NO_FACET)),
  }), [allExercises, deferredQ, pickerMuscle, pickerTypeFilter, pickerEquipFilter]);

  const filtered = useMemo(
    () => allExercises.filter(e => matchesAll(e, deferredQ, pickerMuscle, pickerTypeFilter, pickerEquipFilter)),
    [allExercises, deferredQ, pickerMuscle, pickerTypeFilter, pickerEquipFilter]
  );
  const selIds = useMemo(() => new Set(pickerSelected.map(e => e.exId)), [pickerSelected]);
  // Stable rowProps identity so the memo'd rows only re-render when the data
  // they show actually changes.
  const rowProps = useMemo(
    () => ({ exercises: filtered, selIds, onToggle: pickerToggleEx }),
    [filtered, selIds, pickerToggleEx]
  );

  return (
    // onClose is closePicker — the FULL teardown (search, facets, selection),
    // never a bare setter; see rowInvariants.test.js.
    <Sheet
      open
      onClose={closePicker}
      layer={"picker"}
      tall
      scroll={"none"}
      // Explicit height (the tall cap): the list no longer stretches the
      // sheet to the cap by inflating to content height, and the absolute
      // List needs the flex chain above it to be definite. Also keeps the
      // sheet stable when a search has zero matches.
      style={{ height: '92dvh' }}
      title={pickerSelected.length > 0 ? `Add to Workout · ${pickerSelected.length} selected` : "Add to Workout"}
      ariaLabel={"Add exercises to workout"}
      headerRight={
        <div style={{ display: "flex", gap: S.s6, flexShrink: 0 }}>
          {pickerSelected.length > 0 && (
            <button className={"btn btn-gold btn-xs"} onClick={commitPickerToWorkout}>{"＋ Add " + pickerSelected.length}</button>
          )}
          <button className={"btn btn-ghost btn-xs"} onClick={() => { closePicker(); openExEditor("create", null); }}>{"✦ New Custom"}</button>
        </div>
      }
    >
        {/* ── Search bar ── */}
        <div style={{ marginBottom: S.s8, flexShrink: 0 }}>
          <input
            className={"inp"}
            style={{ width: "100%", padding: "8px 12px", fontSize: FS.fs82 }}
            placeholder={"Search exercises…"}
            value={pickerSearch}
            onChange={e => setPickerSearch(e.target.value)}
            autoFocus={true}
          />
        </div>

        {/* ── Filter dropdowns ──
            Three hand-rolled single-select panels used to live here: ~100
            lines of div-with-onClick, no roles, no keyboard path, no counts,
            duplicating what the library tab already had in an accessible
            form. They are the shared FilterDropdown now, which also brings
            multi-select and faceted counts in line with the library. */}
        <div style={{ position: "relative", marginBottom: S.s10, flexShrink: 0 }}>
          {pickerOpenDrop && <div aria-hidden={"true"} onClick={closeDrops} style={{ position: "fixed", inset: 0, zIndex: 19 }} />}
          <div style={{ display: "flex", gap: S.s8 }}>
            <FilterDropdown
              id="wb-muscle"
              label="Muscle"
              shortLabel="Muscle"
              options={MUSCLE_OPTS}
              optionLabel={muscleLabel}
              selected={pickerMuscle}
              counts={facetCounts.muscle}
              onToggle={toggleMuscle}
              open={pickerOpenDrop === "wb-muscle"}
              setOpen={setPickerOpenDrop}
              accent="#7A8F8B"
              optionAccent={getMuscleColor}
              panelBorder="rgba(122,143,139,.25)"
            />
            <FilterDropdown
              id="wb-type"
              label="Type"
              shortLabel="Type"
              options={TYPE_OPTS}
              optionLabel={typeLabel}
              selected={pickerTypeFilter}
              counts={facetCounts.type}
              onToggle={toggleType}
              open={pickerOpenDrop === "wb-type"}
              setOpen={setPickerOpenDrop}
              accent="#C4A044"
              optionAccent={getTypeColor}
              panelBorder="rgba(180,172,158,.07)"
            />
            <FilterDropdown
              id="wb-equip"
              label="Equipment"
              shortLabel="Equip"
              options={EQUIP_OPTS}
              optionLabel={equipLabel}
              selected={pickerEquipFilter}
              counts={facetCounts.equip}
              onToggle={toggleEquip}
              open={pickerOpenDrop === "wb-equip"}
              setOpen={setPickerOpenDrop}
              accent={UI_COLORS.accent}
              panelBorder="rgba(196,148,40,0.25)"
            />
          </div>
        </div>

        {/* ── Exercise list (virtualized) ── */}
        {filtered.length === 0 ? (
          <div className={"empty"} style={{ padding: "20px 0" }}>{"No exercises found."}</div>
        ) : (
          <>
            <div style={{ fontSize: FS.fs62, color: "#8a8478", marginBottom: S.s6, textAlign: "right", flexShrink: 0 }}>
              {filtered.length + " match" + (filtered.length !== 1 ? "es" : "")}
            </div>
            {/* The virtualized list is the sheet's ONLY scroller (the Sheet
                body is scroll="none") — no more scroll-in-scroll. The List is
                absolutely inset in a position:relative wrapper because it
                needs a DEFINITE height: height:100% resolved against this
                content-sized flex chain as auto, so the List element inflated
                to full content height, react-window measured that as its
                viewport, and every one of ~1,500 rows rendered on open
                (audit finding #7). */}
            <div style={{ flex: "1 1 auto", minHeight: 120, position: "relative" }}>
              <List
                rowCount={filtered.length}
                rowHeight={60}
                rowComponent={WbExPickerRow}
                rowProps={rowProps}
                overscanCount={6}
                style={{ position: "absolute", inset: 0, width: "100%", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}
              />
            </div>
          </>
        )}
    </Sheet>
  );
});

export default WorkoutExercisePicker;
