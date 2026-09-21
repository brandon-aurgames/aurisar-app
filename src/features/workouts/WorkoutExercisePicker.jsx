import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
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
import { buildGroupedItems, muscleKey } from './pickerGrouping';

// Module scope so the memo'd FilterDropdown sees a stable optionLabel identity.
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

const HEADER_H = 44;
// Compact picker slot: 12px horizontal inset + 6px vertical padding inside
// the card. Tall enough for a two-line clamped name plus its meta line —
// 60 used to clip and overlap on phones. The library list stays at 88.
const ROW_H = 72;

// One row adapter for the virtualised list. Each item is either a collapsible
// muscle-group header or an exercise row (the shared ExerciseRow) — react-window
// renders a single flat list, so grouping stays virtualized: a collapsed group
// contributes only its header, never its (up to ~370) rows.
const WbPickerItem = React.memo(function WbPickerItem({
  ariaAttributes, index, style, items, selIds, onToggle, onToggleGroup
}) {
  const it = items[index];
  if (!it) return null;
  if (it.kind === 'header') {
    return (
      <div style={style} {...ariaAttributes}>
        <button
          type="button"
          className={"wb-ex-group-hdr"}
          style={{ "--mg-color": getMuscleColor(it.muscle) }}
          aria-expanded={it.expanded}
          onClick={() => onToggleGroup(it.muscle)}
        >
          <span className={"wb-ex-group-chevron"} aria-hidden={"true"}>{it.expanded ? "▾" : "▸"}</span>
          <span className={"wb-ex-group-name orb-action-label"}>{it.label}</span>
          <span className={"wb-ex-group-count"}>{it.count}</span>
        </button>
      </div>
    );
  }
  const ex = it.ex;
  return (
    <div style={{ ...style, padding: "3px 12px" }} {...ariaAttributes}>
      <ExerciseRow
        ex={ex}
        selected={selIds.has(ex.id)}
        selectable
        showCustomBadge
        className={"wb-pcard"}
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
  const listUnlisten = useRef(null);
  const [listAtTop, setListAtTop] = useState(true);

  // The virtualized list is the sheet's only scroller. Capture its scroll
  // position so a pull from the top can dismiss the picker — without this,
  // overscroll is contained and there is no way to "scroll up to exit".
  const setListWrap = useCallback(el => {
    if (listUnlisten.current) {
      listUnlisten.current();
      listUnlisten.current = null;
    }
    if (!el) return;
    const onScroll = e => {
      if (e.target && typeof e.target.scrollTop === 'number') {
        setListAtTop(e.target.scrollTop <= 0);
      }
    };
    el.addEventListener('scroll', onScroll, true);
    listUnlisten.current = () => el.removeEventListener('scroll', onScroll, true);
  }, []);

  // The input stays bound to pickerSearch (urgent) while the full-catalog
  // scans below run against the deferred value, so a keystroke no longer
  // blocks on three facet passes plus the filter pass over ~1,500 exercises.
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

  // ── Muscle grouping (collapsible sections) ──
  // Sections default collapsed so the picker opens as a short muscle menu; an
  // active search force-expands every section so matches are never hidden, and
  // a lone section (e.g. the Muscle facet narrowed to one) opens on its own.
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const searching = deferredQ.trim() !== '';
  const isExpanded = useCallback(
    (muscle, groupCount) => searching || groupCount === 1 || expandedGroups.has(muscle),
    [searching, expandedGroups]
  );
  const { groups, items } = useMemo(() => buildGroupedItems(filtered, isExpanded), [filtered, isExpanded]);
  const toggleGroup = useCallback(muscle => setExpandedGroups(prev => {
    const n = new Set(prev);
    n.has(muscle) ? n.delete(muscle) : n.add(muscle);
    return n;
  }), []);
  const allExpanded = groups.length > 0 && groups.every(g => expandedGroups.has(g.muscle));
  const expandAll = useCallback(() => setExpandedGroups(new Set(groups.map(g => g.muscle))), [groups]);
  const collapseAll = useCallback(() => setExpandedGroups(new Set()), []);

  // After a search pick, clearing the query used to collapse every section
  // again — the selected row vanished even though its removal chip stayed.
  // When search goes idle, keep each selected exercise's muscle group open.
  useEffect(() => {
    if (searching || pickerSelected.length === 0) return;
    setExpandedGroups(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const sel of pickerSelected) {
        const ex = allExercises.find(e => e.id === sel.exId);
        if (!ex) continue;
        const muscle = muscleKey(ex);
        if (!next.has(muscle)) {
          next.add(muscle);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [searching, pickerSelected, allExercises]);

  // Stable rowProps identity so the memo'd rows only re-render when the data
  // they show actually changes.
  const rowProps = useMemo(
    () => ({ items, selIds, onToggle: pickerToggleEx, onToggleGroup: toggleGroup }),
    [items, selIds, pickerToggleEx, toggleGroup]
  );
  // Headers are shorter than exercise rows; react-window reads this per index.
  const rowHeight = useCallback((index, props) => (props.items[index]?.kind === 'header' ? HEADER_H : ROW_H), []);
  const rowKey = useCallback((index, data) => {
    const it = data.items[index];
    if (!it) return index;
    return it.kind === 'header' ? 'h:' + it.muscle : 'r:' + it.ex.id;
  }, []);

  return (
    // onClose is closePicker — the FULL teardown (search, facets, selection),
    // never a bare setter; see rowInvariants.test.js.
    <Sheet
      open
      onClose={closePicker}
      layer={"picker"}
      glass
      swipeDismiss
      navOffset={false}
      innerScrolledToTop={listAtTop}
      scroll={"none"}
      className={"wb-picker-sheet"}
      // height:100% plus .wb-picker-sheet stretching the backdrop gives the
      // flex chain a definite box so the absolutely-inset List virtualizes.
      style={{ height: '100%' }}
      title={"Add to Workout"}
      ariaLabel={"Add exercises to workout"}
      bodyClassName={"wb-picker-body"}
      headerRight={
        <button className={"btn btn-ghost btn-xs"} onClick={() => { closePicker(); openExEditor("create", null); }}>{"✦ New Custom"}</button>
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

        {/* ── Exercise list (virtualized, grouped by muscle) ── */}
        {filtered.length === 0 ? (
          <div className={"empty"} style={{ padding: "20px 0" }}>{"No exercises found."}</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: S.s8, marginBottom: S.s6, flexShrink: 0 }}>
              {!searching && groups.length > 1 ? (
                <button
                  type="button"
                  className={"btn btn-ghost btn-xs"}
                  onClick={allExpanded ? collapseAll : expandAll}
                >{allExpanded ? "Collapse all" : "Expand all"}</button>
              ) : <span />}
              <span style={{ fontSize: FS.fs62, color: "#8a8478", textAlign: "right" }}>
                {filtered.length + " match" + (filtered.length !== 1 ? "es" : "")}
              </span>
            </div>
            {/* The virtualized list is the sheet's ONLY scroller (the Sheet
                body is scroll="none") — no more scroll-in-scroll. The List is
                absolutely inset in a position:relative wrapper so it measures a
                DEFINITE box. Muscle headers and exercise rows share this one
                flat list, so a collapsed section costs a single header row.
                ＋ Add N is a shrink-wrapped glass chip over the list so the
                last rows stay visible behind it. */}
            <div
              ref={setListWrap}
              className={`wb-picker-list-wrap${pickerSelected.length > 0 ? " has-add-overlay" : ""}`}
              style={{ flex: "1 1 auto", minHeight: 120, position: "relative" }}
            >
              <List
                rowCount={items.length}
                rowHeight={rowHeight}
                rowKey={rowKey}
                rowComponent={WbPickerItem}
                rowProps={rowProps}
                overscanCount={6}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  overscrollBehavior: "contain",
                }}
              />
              <div className={"wb-picker-add-overlay"} aria-hidden={pickerSelected.length === 0}>
                {pickerSelected.length > 0 && (
                  <button
                    type="button"
                    className={"wb-picker-add-btn"}
                    onClick={commitPickerToWorkout}
                  >
                    {"＋ Add " + pickerSelected.length}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
    </Sheet>
  );
});

export default WorkoutExercisePicker;
