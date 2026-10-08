import React, { memo, useMemo, useRef, useState } from 'react';
import { ExIcon } from '../../components/ExIcon';
import { getMuscleColor, getTypeColor, calcExXP, calcExEntryXP, calcWorkoutXP } from '../../utils/xp';
import { lbsToKg, isMetric, displayWt } from '../../utils/units';
import { formatXP } from '../../utils/format';
import { todayStr } from '../../utils/helpers';
import { combineHHMMSec, daysUntil } from '../../utils/time';
import { S, R, FS, Z } from '../../utils/tokens';
import SetsEditor from '../../components/ui/SetsEditor';
import FilterDropdown from '../exercises/FilterDropdown';
import IconButton from '../../components/ui/IconButton';
import Sheet from '../../components/ui/Sheet';
import ConfirmSheet from '../../components/ui/ConfirmSheet';
import WorkoutDetails from './WorkoutDetails';
import { buildWorkoutObject } from './workoutModel';
import {
  SS_MAX,
  adjacentGroupId,
  eachRun,
  groupLetter,
  groupStaged,
  memberBadge,
  mergeOnto,
  moveExercise,
  normalizeSupersetGroups,
  removeExercise,
  ungroup,
} from './supersetModel';
import { useBuilderPointerDnd } from './useBuilderPointerDnd';
import { UI_COLORS, MUSCLE_COLORS, WORKOUT_TEMPLATES, NO_SETS_EX_IDS, RUNNING_EX_ID } from '../../data/constants';

/**
 * Workouts tab — extracted from the inline IIFE in App.jsx as part of
 * Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Contains four views: list, recipes (templates), detail, builder.
 *
 * Co-located sub-components / helpers:
 *   WbExCard             — memoized exercise row in the workout builder
 *   SsStagingBar         — group-as-superset action bar
 *   getWorkoutMgColor    — derive card accent from dominant muscle group
 *   getRecipeMgColor     — derive card accent from recipe category
 */

// ── Module-level constants (hoisted from App.jsx) ──
const RECIPE_CATS = [...new Set([...WORKOUT_TEMPLATES.map(t => t.category).filter(Boolean), ...WORKOUT_TEMPLATES.map(t => t.equipment).filter(Boolean)])].sort();
const EQUIP_ICONS = {
  Gym: "🏋️",
  "Home Gym": "🏠",
  Bodyweight: "🤸"
};
const RECIPE_CAT_COLORS = {
  "Push": "#8B5A2B",
  "Pull": "#2E4D38",
  "Legs": "#5C5C2E",
  "Full Body": "#2C4564",
  "Upper Body": "#6B2A2A",
  "Lower Body": "#5C5C2E",
  "Chest": "#8B5A2B",
  "Back": "#2E4D38",
  "Shoulders": "#3D343F",
  "Arms": "#4A5560",
  "Glutes": "#4F4318",
  "Core": "#2A4347",
  "Abs": "#2A4347",
  "Cardio": "#2C4564",
  "HIIT": "#6B2A2A",
  "Endurance": "#494C56",
  "Flexibility": "#3D343F",
  "Yoga": "#3D343F",
  "Mobility": "#3D343F",
  "Gym": "#4F4318",
  "Home Gym": "#8B5A2B",
  "Bodyweight": "#2E4D38"
};
function getRecipeMgColor(tpl) {
  if (!tpl) return "#B0A090";
  return RECIPE_CAT_COLORS[tpl.category] || RECIPE_CAT_COLORS[tpl.equipment] || "#B0A090";
}
// Recipe facet counts never change — the template list is static.
const RECIPE_CAT_COUNTS = (() => {
  const c = new Map();
  for (const t of WORKOUT_TEMPLATES) {
    for (const k of [t.category, t.equipment]) {
      if (k) c.set(k, (c.get(k) || 0) + 1);
    }
  }
  return c;
})();
// Recipe XP depends only on the (static) template and the player's class,
// so cache it per class instead of reducing over every template each render.
const _recipeXpCache = new Map(); // chosenClass -> Map<tplId, xp>
function recipeXP(tpl, chosenClass, allExById) {
  let byTpl = _recipeXpCache.get(chosenClass);
  if (!byTpl) {
    byTpl = new Map();
    _recipeXpCache.set(chosenClass, byTpl);
  }
  if (!byTpl.has(tpl.id)) {
    byTpl.set(tpl.id, tpl.exercises.reduce((t, ex) => t + calcExXP(ex.exId, ex.sets, ex.reps, chosenClass, allExById), 0));
  }
  return byTpl.get(tpl.id);
}
function getWorkoutMgColor(wo, exById, mgColors) {
  if (!wo || !wo.exercises) return "#B0A090";
  const counts = {};
  for (const ex of wo.exercises) {
    const exD = exById[ex.exId];
    if (!exD) continue;
    const mg = (exD.muscleGroup || "").toLowerCase().trim();
    if (!mg) continue;
    counts[mg] = (counts[mg] || 0) + 1;
  }
  let top = null, topN = 0;
  for (const k in counts) {
    if (counts[k] > topN) { top = k; topN = counts[k]; }
  }
  return top && mgColors[top] || "#B0A090";
}

function formatExPb(exPB, units) {
  if (!exPB) return null;
  const metric = isMetric(units);
  const val = exPB.value ?? exPB.weight;
  if (val == null || val === "") return null;
  const type = (exPB.type || "").toLowerCase();
  if (type === "cardio" || type === "cardio pace") {
    const n = Number(val);
    if (!Number.isFinite(n)) return null;
    return metric ? parseFloat((n * 1.60934).toFixed(2)) + " min/km" : parseFloat(n.toFixed(2)) + " min/mi";
  }
  const wt = displayWt(val, units) || (metric ? String(val) + " kg" : String(val) + " lbs");
  if (type === "assisted" || type === "assisted weight") return "🏆 1RM: " + wt + " (Assisted)";
  if (type === "max reps per 1 set") return "🏆 " + val + " reps";
  if (type === "longest hold" || type === "fastest time") {
    const n = Number(val);
    return Number.isFinite(n) ? "🏆 " + parseFloat(n.toFixed(2)) + " min" : null;
  }
  if (type === "heaviest weight") return "🏆 " + wt;
  return "🏆 1RM: " + wt;
}

function lastDoneLabel(dateKey) {
  if (!dateKey) return "Not logged yet";
  const today = todayStr();
  if (dateKey === today) return "Last done today";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yest = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  if (dateKey === yest) return "Last done yesterday";
  return "Last done " + dateKey;
}

function IntensityChip({ value }) {
  const label = { low: 'Low', moderate: 'Moderate', high: 'High' }[value];
  return label ? <span className="workout-intensity">{label} intensity</span> : null;
}

function SsStagingBar({ count, joinLetter, onGroup, onCancel }) {
  const ready = count >= 2 || !!joinLetter;
  const text = joinLetter
    ? `Add to Superset ${joinLetter}`
    : count === 1
      ? "Select 1 more to superset"
      : `${count} selected — ready to group`;
  return <div className={"ss-action-bar"}><span className={"ss-action-text"}>{text}</span>{ready && <button type={"button"} className={"ss-action-btn"} onClick={onGroup}>{joinLetter ? `🔗 Add to ${joinLetter}` : "🔗 Group as Superset"}</button>}<button type={"button"} className={"ss-action-cancel"} onClick={onCancel} aria-label={"Cancel superset selection"}>{"✕"}</button></div>;
}

const WbExCard = React.memo(function WbExCard({
  ex,
  i,
  exD,
  collapsed,
  profile,
  allExById,
  metric,
  setWbExercises,
  setCollapsedWbEx,
  setSsChecked,
  ssChecked,
  exCount,
  openExEditor,
  canMoveUp,
  canMoveDown,
  grouped,
  orderBadge,
}) {
  function updateField(field, val) {
    setWbExercises(exs => exs.map((e, j) => j !== i ? e : {
      ...e,
      [field]: val
    }));
  }
  function removeEx() {
    setSsChecked(new Set());
    setWbExercises(exs => removeExercise(exs, i));
  }
  function toggleCollapse() {
    setCollapsedWbEx(s => ({
      ...s,
      [i]: !s[i]
    }));
  }
  function reorder(dir) {
    setSsChecked(new Set());
    setWbExercises(exs => moveExercise(exs, i, dir));
  }
  const [menuOpen, setMenuOpen] = useState(false);
  const noSetsEx = NO_SETS_EX_IDS.has(exD.id);
  const isRunningEx = exD.id === RUNNING_EX_ID;
  const age = profile.age || 30;
  const pbPaceMi = profile.runningPB || null;
  const pbDisp = pbPaceMi ? metric ? parseFloat((pbPaceMi * 1.60934).toFixed(2)) + " min/km" : parseFloat(pbPaceMi.toFixed(2)) + " min/mi" : null;
  const exPBDisp = formatExPb((profile.exercisePBs || {})[exD.id], profile.units);
  function toggleSuperset(e) {
    e.stopPropagation();
    setSsChecked(prev => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i); else {
        if (n.size >= SS_MAX) {
          const oldest = [...n][0];
          n.delete(oldest);
        }
        n.add(i);
      }
      return n;
    });
  }
  const durationMin = parseFloat(ex.reps || 0);
  const distMiVal = ex.distanceMi ? parseFloat(ex.distanceMi) : 0;
  const runPace = isRunningEx && distMiVal > 0 && durationMin > 0 ? durationMin / distMiVal : null;
  const runBoostPct = runPace ? runPace <= 8 ? 20 : 5 : 0;
  const mgColor = getMuscleColor(exD.muscleGroup);
  const reorderBtns = <div className={"wb-reorder"}><IconButton label={`Move ${exD.name} up`} size={20} disabled={!canMoveUp} onClick={e => {
          e.stopPropagation();
          reorder(-1);
        }}>{"▲"}</IconButton><IconButton label={`Move ${exD.name} down`} size={20} disabled={!canMoveDown} onClick={e => {
          e.stopPropagation();
          reorder(1);
        }}>{"▼"}</IconButton></div>;
  const supersetBtn = !grouped && exCount >= 2 ? <button type={"button"} className={"ss-cb-hit"} title={"Select for superset"} aria-pressed={ssChecked.has(i)} aria-label={`Toggle superset for ${exD.name}`} onClick={toggleSuperset}><div className={`ss-cb ${ssChecked.has(i) ? "on" : ""}`} /><span style={{
          fontSize: FS.fs55,
          color: ssChecked.has(i) ? "#b0b8c0" : "#8a8f96",
          fontWeight: 600,
          letterSpacing: ".03em",
          userSelect: "none"
        }}>{"Superset"}</span></button> : null;
  const removeBtn = <button type={"button"} aria-label={`Remove ${exD.name}`} title={"Remove"} className={"btn btn-danger btn-xs"} onClick={e => {
        e.stopPropagation();
        removeEx();
      }}>{"✕"}</button>;
  return <><div className={"wb-ex-hdr"} onClick={() => toggleCollapse()}><div className={"wb-ex-tools-wide"}>{reorderBtns}{supersetBtn}</div><span data-drag-handle={"true"} className={"drag-handle"} aria-hidden={"true"} title={"Drag to reorder"}>{"⠿"}</span><div className={"builder-ex-orb"} style={{
        "--mg-color": mgColor
      }}><ExIcon ex={exD} size={".95rem"} color={"#d4cec4"} /></div><div className={"builder-ex-name-styled"}>{exD.name}{exD.custom && <span className={"custom-ex-badge"} style={{
          marginLeft: S.s4
        }}>{"custom"}</span>}{exD.custom && <button className={"btn btn-ghost btn-xs"} style={{
          marginLeft: S.s6,
          fontSize: FS.fs55,
          padding: "2px 6px"
        }} onClick={e => {
          e.stopPropagation();
          openExEditor("edit", exD);
        }}>{"✎ edit"}</button>}</div>{orderBadge && <span className={"ss-badge"}>{orderBadge}</span>}{(isRunningEx && pbDisp || exPBDisp) && <span style={{
        fontSize: FS.fs58,
        color: "#b4ac9e",
        flexShrink: 0
      }}>{"🏆 "}{isRunningEx && pbDisp ? pbDisp : exPBDisp}</span>}{collapsed && exD.id !== "rest_day" && <span style={{
        fontSize: FS.sm,
        color: "#8a8478"
      }}>{noSetsEx ? "" : ex.sets + "×"}{ex.reps}{ex.weightLbs ? ` · ${displayWt(ex.weightLbs, profile.units)}` : ""}</span>}<span style={{
        fontSize: FS.fs63,
        color: "#b4ac9e",
        flexShrink: 0
      }}>{formatXP(calcExEntryXP(ex, profile.chosenClass, allExById), {
          signed: true
        })}{runBoostPct > 0 && <span style={{
          color: UI_COLORS.warning,
          marginLeft: S.s2
        }}>{"⚡"}</span>}</span><span style={{
        fontSize: FS.sm,
        color: "#8a8478",
        transition: "transform .2s",
        transform: collapsed ? "rotate(0deg)" : "rotate(180deg)",
        flexShrink: 0,
        lineHeight: 1
      }}>{"▼"}</span><div className={"wb-ex-tools-wide"}>{removeBtn}</div><div className={"wb-ex-overflow"}><button type={"button"} className={"wb-ex-overflow-btn"} aria-label={`More actions for ${exD.name}`} aria-expanded={menuOpen} onClick={e => {
        e.stopPropagation();
        setMenuOpen(v => !v);
      }}>{"···"}</button>{menuOpen && <><div className={"wb-ex-menu-scrim"} onClick={e => {
        e.stopPropagation();
        setMenuOpen(false);
      }} /><div className={"wb-ex-menu"} role={"menu"}><button type={"button"} role={"menuitem"} disabled={!canMoveUp} onClick={e => {
        e.stopPropagation();
        reorder(-1);
        setMenuOpen(false);
      }}>{"Move up"}</button><button type={"button"} role={"menuitem"} disabled={!canMoveDown} onClick={e => {
        e.stopPropagation();
        reorder(1);
        setMenuOpen(false);
      }}>{"Move down"}</button>{!grouped && exCount >= 2 && <button type={"button"} role={"menuitem"} onClick={e => {
        toggleSuperset(e);
        setMenuOpen(false);
      }}>{ssChecked.has(i) ? "Unmark superset" : "Mark as superset"}</button>}<button type={"button"} role={"menuitem"} className={"danger"} onClick={e => {
        e.stopPropagation();
        removeEx();
        setMenuOpen(false);
      }}>{"Remove"}</button></div></>}</div></div>{!collapsed && exD.id !== "rest_day" && <div className={"wb-ex-body"}>
    <SetsEditor exD={exD} value={ex} onField={updateField} units={profile.units} age={age} variant={"builder"} />
  </div>}</>;
});

const WorkoutsTab = memo(function WorkoutsTab({
  isActive = true,
  // View state
  workoutView, setWorkoutView,
  workoutSubTab, setWorkoutSubTab,
  // Label filter
  woLabelFilters, setWoLabelFilters,
  woLabelDropOpen, setWoLabelDropOpen,
  newLabelInput, setNewLabelInput,
  // Active workout
  activeWorkout, setActiveWorkout,
  // Live workout tracker
  liveWorkout, startLiveWorkout,
  // Profile
  profile, setProfile,
  // Recipe view
  recipeFilter, setRecipeFilter,
  recipeCatDrop, setRecipeCatDrop,
  expandedRecipeDesc, setExpandedRecipeDesc,
  expandedRecipeEx, setExpandedRecipeEx,
  // Builder state
  wbName, setWbName,
  wbIcon, setWbIcon,
  wbDesc, setWbDesc,
  wbIntensity, setWbIntensity,
  wbExercises, setWbExercises,
  wbEditId, setWbEditId,
  wbIsOneOff, setWbIsOneOff,
  wbLabels, setWbLabels,
  wbDuration, setWbDuration,
  wbDurSec, setWbDurSec,
  wbActiveCal, setWbActiveCal,
  wbTotalCal, setWbTotalCal,
  wbCopySource, setWbCopySource,
  wbIconPickerOpen, setWbIconPickerOpen,
  wbExPickerOpen, setWbExPickerOpen,
  wbTotalXP,
  collapsedWbEx, setCollapsedWbEx,
  ssChecked, setSsChecked,
  dragWbExIdx, setDragWbExIdx,
  // Callbacks (defined in App)
  initWorkoutBuilder,
  copyWorkout,
  openCompletionFlow,
  setConfirmDelete,
  openQuickLog,
  setPendingSoloRemoveId,
  quickLogSoloEx,
  openScheduleEx,
  setAddToWorkoutPicker,
  openExEditor,
  setAddToPlanPicker,
  deleteWorkout,
  reorderSupersetPair,
  reorderWbEx,
  saveBuiltWorkout,
  saveAsNewWorkout,
  showToast,
  // Computed
  allExById,
  clsColor,
}) {
const metric = isMetric(profile.units);
const allW = useMemo(() => profile.workouts || [], [profile.workouts]);
const [woSearch, setWoSearch] = useState("");
const [woSort, setWoSort] = useState("recent");
const [helpOpen, setHelpOpen] = useState(false);
const [wbNameError, setWbNameError] = useState("");
const [confirmCancel, setConfirmCancel] = useState(false);
const lastDoneMap = useMemo(() => {
  const m = new Map();
  for (const e of profile.log || []) {
    if (!e.sourceWorkoutId || !e.dateKey) continue;
    const prev = m.get(e.sourceWorkoutId);
    if (!prev || e.dateKey > prev) m.set(e.sourceWorkoutId, e.dateKey);
  }
  return m;
}, [profile.log]);
const reusableFiltered = useMemo(() => {
  const q = woSearch.trim().toLowerCase();
  let list = allW.filter(w => !w.oneOff);
  if (woLabelFilters.size > 0) list = list.filter(w => (w.labels || []).some(l => woLabelFilters.has(l)));
  if (q) list = list.filter(w => (w.name || "").toLowerCase().includes(q));
  return [...list].sort((a, b) => {
    if (woSort === "name") return (a.name || "").localeCompare(b.name || "");
    const da = lastDoneMap.get(a.id) || "";
    const db = lastDoneMap.get(b.id) || "";
    if (da !== db) return db.localeCompare(da);
    return (a.name || "").localeCompare(b.name || "");
  });
}, [allW, woLabelFilters, woSearch, woSort, lastDoneMap]);
function guardWbName() {
  if (!wbName.trim()) {
    setWbNameError("Name your workout first.");
    return false;
  }
  setWbNameError("");
  return true;
}
function leaveBuilder() {
  setWorkoutView("list");
  setWbCopySource(null);
  setWbIsOneOff(false);
  setWbEditId(null);
  setWbDuration("");
  setWbDurSec("");
  setWbActiveCal("");
  setWbTotalCal("");
  setWbLabels([]);
  setNewLabelInput("");
  setWbNameError("");
  setConfirmCancel(false);
}
function requestLeaveBuilder() {
  if (wbExercises.length > 0) {
    setConfirmCancel(true);
    return;
  }
  leaveBuilder();
}
// Per-workout XP + accent, computed once per relevant-input change rather
// than per card on every render. Keyed on the workout list, the class
// (multiplier) and the catalog.
const woMeta = useMemo(() => {
  const m = new Map();
  for (const w of allW) {
    m.set(w.id, {
      xp: calcWorkoutXP(w, profile.chosenClass, allExById),
      mgColor: getWorkoutMgColor(w, allExById, MUSCLE_COLORS),
    });
  }
  return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [allW, profile.chosenClass, allExById]);
const woLabelCounts = useMemo(() => {
  const c = new Map();
  for (const w of allW) {
    for (const l of w.labels || []) c.set(l, (c.get(l) || 0) + 1);
  }
  return c;
}, [allW]);

const wbListRef = useRef(null);
useBuilderPointerDnd({
  listRef: wbListRef,
  exercises: wbExercises,
  enabled: isActive && workoutView === "builder",
  onReorder: reorderWbEx,
  onMerge: (from, onto) => {
    setSsChecked(new Set());
    setWbExercises(xs => mergeOnto(xs, from, onto));
  },
});
// ── LIST ───────────────────────────────
if (workoutView === "list") return <><div className={"wo-sticky-filters"}><div style={{
      marginBottom: S.s8
    }}><div className={"rpg-sec-header rpg-sec-header-center"}><div className={"rpg-sec-line rpg-sec-line-l"} /><span className={"rpg-sec-title"}>{"✦ Workouts ✦"}<button type={"button"} className={`info-icon${helpOpen ? " open" : ""}`} aria-label={"About workouts"} aria-expanded={helpOpen} onClick={() => setHelpOpen(v => !v)}>{"?"}<span className={"info-tooltip"}>{"Saved workouts you can start at the gym or log after. Build once, reuse anytime."}</span></button></span><div className={"rpg-sec-line rpg-sec-line-r"} /></div></div>
    {
      /* Subtabs */
    }<div className={"log-subtab-bar"} style={{
      marginBottom: S.s0
    }}>{[["reusable", "Reusable"], ["scheduled", "Scheduled"]].map(([t, l]) => <button key={t} className={`log-subtab-btn ${workoutSubTab === t ? "on" : ""}`} onClick={() => setWorkoutSubTab(t)}>{l}</button>)}</div></div>
  {
    /* Label filter dropdown */
  }{(profile.workoutLabels || []).length > 0 && <div style={{
    display: "flex",
    gap: S.s8,
    marginBottom: S.s10,
    position: "relative"
  }}>{woLabelDropOpen && <div aria-hidden={"true"} onClick={() => setWoLabelDropOpen(false)} style={{
      position: "fixed",
      inset: 0,
      zIndex: Z.scrim
    }} />}<FilterDropdown
      id={"wo-labels"}
      label={"Labels"}
      shortLabel={"Labels"}
      options={profile.workoutLabels || []}
      optionLabel={l => l}
      selected={woLabelFilters}
      counts={woLabelCounts}
      onToggle={l => setWoLabelFilters(sHas => {
        const n = new Set(sHas);
        n.has(l) ? n.delete(l) : n.add(l);
        return n;
      })}
      open={!!woLabelDropOpen}
      setOpen={v => setWoLabelDropOpen(v === "wo-labels")}
      accent={"#C4A044"}
      panelBorder={"rgba(196,148,40,0.25)"}
      footer={<div className={"wo-label-new-row"}><input className={"wo-label-new-inp"} value={newLabelInput} onChange={e => setNewLabelInput(e.target.value)} onClick={e => e.stopPropagation()} onKeyDown={e => {
        e.stopPropagation();
        if (e.key === "Enter" && newLabelInput.trim()) {
          const lbl = newLabelInput.trim();
          if (!(profile.workoutLabels || []).some(x => x.toLowerCase() === lbl.toLowerCase())) {
            setProfile(pf => ({
              ...pf,
              workoutLabels: [...(pf.workoutLabels || []), lbl]
            }));
          }
          setNewLabelInput("");
        }
      }} placeholder={"+ New label…"} /><button className={"btn btn-ghost btn-xs"} style={{
        padding: "2px 6px",
        fontSize: FS.sm
      }} onClick={e => {
        e.stopPropagation();
        const lbl = newLabelInput.trim();
        if (!lbl) return;
        if (!(profile.workoutLabels || []).some(x => x.toLowerCase() === lbl.toLowerCase())) {
          setProfile(pf => ({
            ...pf,
            workoutLabels: [...(pf.workoutLabels || []), lbl]
          }));
        }
        setNewLabelInput("");
      }}>{"+"}</button></div>}
    />{woLabelFilters.size > 0 && <button className={"btn btn-ghost btn-xs"} style={{
      fontSize: FS.sm,
      color: "#b4ac9e",
      alignSelf: "center"
    }} onClick={() => setWoLabelFilters(new Set())}>{"Clear"}</button>}</div>}{workoutSubTab === "reusable" && <><div style={{
      display: "flex",
      gap: S.s8,
      marginBottom: S.s14
    }}><button className={"btn btn-gold btn-sm"} onClick={() => initWorkoutBuilder(null)}>{"＋ New Workout"}</button><button className={"btn btn-ghost btn-sm"} onClick={() => setWorkoutView("recipes")}>{"📋 Recipes"}</button></div>{allW.filter(w => !w.oneOff).length > 0 && <div className={"wo-search-sort"}><input className={"inp"} type={"search"} value={woSearch} onChange={e => setWoSearch(e.target.value)} placeholder={"Search workouts…"} aria-label={"Search workouts"} /><select className={"wo-sort"} value={woSort} onChange={e => setWoSort(e.target.value)} aria-label={"Sort workouts"}><option value={"recent"}>{"Recent"}</option><option value={"name"}>{"Name"}</option></select></div>}{(() => {
      const reusableWo = allW.filter(w => !w.oneOff);
      if (reusableWo.length === 0) return <div className={"empty"} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: S.s12 }}><div>{"No reusable workouts yet."}<br />{"Create your first workout or start from a recipe."}</div><button className={"btn btn-gold-solid btn-sm"} onClick={() => initWorkoutBuilder(null)}>{"＋ New Workout"}</button></div>;
      if (reusableFiltered.length === 0) return <div className={"empty"}>{woSearch.trim() ? "No workouts match that search." : "No workouts match the selected labels."}</div>;
      return null;
    })()}{reusableFiltered.map(wo => {
      const exCount = wo.exercises.length;
      const _meta = woMeta.get(wo.id) || { xp: calcWorkoutXP(wo, profile.chosenClass, allExById), mgColor: getWorkoutMgColor(wo, allExById, MUSCLE_COLORS) };
      const xp = _meta.xp;
      const woMgColor = _meta.mgColor;
      return <div key={wo.id} className={"workout-card"} style={{
        "--mg-color": woMgColor
      }}><div className={"workout-card-top"} style={{
          cursor: "pointer"
        }} onClick={() => {
          setActiveWorkout(wo);
          setWorkoutView("detail");
        }}><div className={"workout-icon"}>{wo.icon}</div><div style={{
            flex: 1,
            minWidth: 0
          }}><div className={"workout-name"}>{wo.name}</div><div className={"workout-meta"}><span className={"workout-tag"}>{exCount}{" exercise"}{exCount !== 1 ? "s" : ""}</span><span className={"workout-tag"}>{formatXP(xp, {
                  prefix: "⚡ "
                })}</span><IntensityChip value={wo.intensity} />{(wo.labels || []).map(l => <span key={l} className={"wo-label-chip"} style={{
                pointerEvents: "none",
                marginLeft: S.s2
              }}>{l}</span>)}</div><div className={"wo-last-done"}>{lastDoneLabel(lastDoneMap.get(wo.id))}</div></div></div><div className={"wo-card-actions"}><button className={`btn btn-gold-solid btn-sm${liveWorkout?.workoutId === wo.id ? " on" : ""}`} onClick={e => { e.stopPropagation(); startLiveWorkout(wo); }}>{"Start"}</button><button className={"btn btn-gold btn-sm"} onClick={e => { e.stopPropagation(); openCompletionFlow(wo); }}>{"Log"}</button></div></div>;
    })}</>}{workoutSubTab === "scheduled" && <>{(() => {
      const _now = new Date();
      const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
      const grouped = {};
      (profile.scheduledWorkouts || []).forEach(sw => {
        if (!sw.sourceWorkoutId) return;
        if (sw.scheduledDate < today) return;
        const key = sw.sourceWorkoutId;
        if (!grouped[key]) grouped[key] = {
          id: sw.sourceWorkoutId,
          name: sw.sourceWorkoutName,
          icon: sw.sourceWorkoutIcon || "⚡",
          date: sw.scheduledDate,
          items: []
        };
        grouped[key].items.push(sw);
      });
      const scheduled = Object.values(grouped).filter(g => {
        if (woLabelFilters.size === 0) return true;
        const wo = (profile.workouts || []).find(w => w.id === g.id);
        return (wo && wo.labels || []).some(l => woLabelFilters.has(l));
      }).sort((a, b) => a.date.localeCompare(b.date));
      const hasSoloExs = (profile.scheduledWorkouts || []).some(sw => !sw.sourceWorkoutId && sw.exId && sw.scheduledDate >= today);
      if (scheduled.length === 0 && !hasSoloExs && woLabelFilters.size === 0) return <div className={"empty"} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: S.s12 }}><div>{"Nothing scheduled yet."}<br />{"Log a workout and pick a future date, or start from a saved one."}</div></div>;
      if (scheduled.length === 0 && !hasSoloExs && woLabelFilters.size > 0) return <div className={"empty"}>{"No scheduled workouts match the selected labels."}</div>;
      if (scheduled.length === 0) return null;
      return scheduled.map(g => {
        const days = daysUntil(g.date);
        const badgeCls = days === 0 ? "badge-today" : days <= 3 ? "badge-soon" : "badge-future";
        const badgeTxt = days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days}d away`;
        const wo = (profile.workouts || []).find(w => w.id === g.id) || {
          id: g.id,
          name: g.name,
          icon: g.icon,
          desc: "",
          exercises: g.items.map(sw => ({
            exId: sw.exId,
            sets: 3,
            reps: 10,
            weightLbs: null,
            weightPct: 100,
            distanceMi: null,
            hrZone: null
          })),
          oneOff: true,
          durationMin: null,
          activeCal: null,
          totalCal: null
        };
        const xp = calcWorkoutXP(wo, profile.chosenClass, allExById);
        const woMgColor = getWorkoutMgColor(wo, allExById, MUSCLE_COLORS);
        return <div key={g.id} className={"workout-card"} style={{
          "--mg-color": woMgColor
        }}><div className={"workout-card-top"} style={{
            cursor: "pointer"
          }} onClick={() => {
            setActiveWorkout(wo);
            setWorkoutView("detail");
          }}><div className={"workout-icon"}>{g.icon}</div><div style={{
              flex: 1,
              minWidth: 0
            }}><div className={"workout-name"}>{g.name}</div><div className={"workout-meta"}><span className={"workout-tag"}>{g.items.length}{" exercise"}{g.items.length !== 1 ? "s" : ""}</span><span className={"workout-tag"}>{formatXP(xp, {
                    prefix: "⚡ "
                  })}</span><span className={`upcoming-badge ${badgeCls}`} style={{
                  marginLeft: S.s4
                }}>{badgeTxt}</span><IntensityChip value={wo.intensity} />{(wo.labels || []).map(l => <span key={l} className={"wo-label-chip"} style={{
                  pointerEvents: "none",
                  marginLeft: S.s2
                }}>{l}</span>)}</div></div></div>
          <div className={"wo-card-actions"}><button className={`btn btn-gold-solid btn-sm${liveWorkout?.workoutId === wo.id ? " on" : ""}`} onClick={e => { e.stopPropagation(); startLiveWorkout(wo); }}>{"Start"}</button><button className={"btn btn-gold btn-sm"} onClick={e => { e.stopPropagation(); openCompletionFlow({ ...wo, oneOff: true }); }}>{"Log"}</button></div>
          <div style={{
            display: "flex",
            gap: S.s6,
            marginTop: S.s6
          }}><button className={"btn btn-ghost btn-xs"} style={{
              fontSize: FS.fs62,
              color: "#b4ac9e"
            }} onClick={() => {
              const reusable = {
                ...wo,
                oneOff: false,
                createdAt: wo.createdAt || todayStr()
              };
              setProfile(p => ({
                ...p,
                workouts: (p.workouts || []).map(w => w.id === wo.id ? reusable : w).concat((p.workouts || []).find(w => w.id === wo.id) ? [] : [reusable]),
                scheduledWorkouts: (p.scheduledWorkouts || []).filter(sw => sw.sourceWorkoutId !== g.id)
              }));
              setWorkoutSubTab("reusable");
              showToast(`\uD83D\uDCAA "${wo.name}" saved as a reusable workout.`);
            }}>{"Make reusable"}</button></div></div>;
      });
    })()}{(() => {
      const _now2 = new Date();
      const today = `${_now2.getFullYear()}-${String(_now2.getMonth() + 1).padStart(2, '0')}-${String(_now2.getDate()).padStart(2, '0')}`;
      const soloExs = (profile.scheduledWorkouts || []).filter(sw => !sw.sourceWorkoutId && sw.exId && sw.scheduledDate >= today).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
      if (soloExs.length === 0) return null;
      return <><div className={"wo-section-hdr"}><span className={"wo-section-hdr-text"}>{"Solo Exercises"}</span></div>{soloExs.map(sw => {
          const ex = allExById[sw.exId];
          if (!ex) return null;
          const days = daysUntil(sw.scheduledDate);
          const badgeCls = days === 0 ? "badge-today" : days <= 3 ? "badge-soon" : "badge-future";
          const badgeTxt = days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days}d away`;
          const soloMg = (ex.muscleGroup || "").toLowerCase().trim();
          const soloMgColor = MUSCLE_COLORS[soloMg] || "#B0A090";
          return <div key={sw.id} className={"workout-card"} style={{
            "--mg-color": soloMgColor
          }}><div className={"workout-card-top"}><div className={"workout-icon"}>{ex.icon}</div><div style={{
                flex: 1,
                minWidth: 0
              }}><div className={"workout-name"}>{ex.name}</div><div className={"workout-meta"}><span className={`upcoming-badge ${badgeCls}`} style={{
                    marginLeft: S.s4
                  }}>{badgeTxt}</span></div>{sw.notes && <div className={"workout-desc"} style={{
                  marginTop: S.s4
                }}>{sw.notes}</div>}</div><div style={{
                display: "flex",
                gap: S.s4,
                flexShrink: 0,
                alignItems: "center"
              }}><button className={"btn btn-ghost btn-sm"} style={{
                  fontSize: FS.fs65,
                  color: "#b4ac9e",
                  padding: "4px 6px",
                  minHeight: 44,
                  minWidth: 44
                }} aria-label={`Log ${ex.name}`} onClick={e => {
                  e.stopPropagation();
                  openQuickLog(sw.exId);
                  setPendingSoloRemoveId(sw.id);
                }}>{"✎"}</button><button className={"btn btn-ghost btn-sm"} style={{
                  color: UI_COLORS.danger,
                  minHeight: 44,
                  minWidth: 44
                }} aria-label={`Remove ${ex.name} from schedule`} onClick={() => {
                  // Confirm before removing, matching workout deletion — the
                  // ✕ used to delete instantly with only a toast.
                  setConfirmDelete({
                    title: "Remove Scheduled Exercise?",
                    body: `Remove ${ex.name} from your schedule?`,
                    icon: "🗑",
                    confirmLabel: "🗑 Remove",
                    onConfirm: () => {
                      setProfile(p => ({
                        ...p,
                        scheduledWorkouts: (p.scheduledWorkouts || []).filter(s => s.id !== sw.id)
                      }));
                      showToast("Scheduled exercise removed.");
                    }
                  });
                }}>{"✕"}</button></div></div><div style={{
              display: "flex",
              gap: S.s6,
              marginTop: S.s6,
              paddingTop: 6,
              borderTop: "1px solid rgba(180,172,158,.04)"
            }}><button className={"btn btn-gold btn-sm"} style={{
                flex: 1
              }} onClick={() => quickLogSoloEx(sw)}>{"⚡ Quick Log"}</button><button className={"btn btn-ghost btn-sm"} style={{
                flex: 1,
                fontSize: FS.fs58,
                borderColor: "rgba(180,172,158,.15)",
                color: "#b4ac9e"
              }} onClick={e => {
                e.stopPropagation();
                openScheduleEx(sw.exId, sw.id);
              }}>{"📅 Reschedule"}</button><button className={"btn btn-ghost btn-sm"} style={{
                flex: 1,
                fontSize: FS.fs58,
                borderColor: "rgba(45,42,36,.3)",
                color: "#8a8478"
              }} onClick={() => {
                const ex2 = allExById[sw.exId];
                if (!ex2) return;
                const exEntry = {
                  exId: ex2.id,
                  sets: ex2.defaultSets || 3,
                  reps: ex2.defaultReps || 10,
                  weightLbs: null,
                  durationMin: null,
                  weightPct: 100,
                  distanceMi: null,
                  hrZone: null
                };
                setAddToWorkoutPicker({
                  exercises: [exEntry]
                });
              }}>{"➕ Add to Workout"}</button></div></div>;
        })}</>;
    })()}</>}</>;

// ── TEMPLATES ──────────────────────────
if (workoutView === "recipes") {
  const filteredTpls = recipeFilter.size === 0 ? WORKOUT_TEMPLATES : WORKOUT_TEMPLATES.filter(t => recipeFilter.has(t.category) || recipeFilter.has(t.equipment));
  // Faceted counts for the shared FilterDropdown (option => how many results
  // selecting it alone would show).
  const recipeCatCounts = RECIPE_CAT_COUNTS;
  return <><div className={"wo-sticky-filters"}><div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: S.s8
      }}><button className={"btn btn-ghost btn-sm"} onClick={() => setWorkoutView("list")}>{"← Back"}</button><div className={"sec"} style={{
          margin: 0,
          border: "none",
          padding: S.s0
        }}>{"Workout Recipes"}</div><div /></div>
      {
        /* Category multi-select dropdown */
      }<div style={{
        display: "flex",
        gap: S.s8,
        marginBottom: S.s0,
        position: "relative"
      }}>{recipeCatDrop && <div aria-hidden={"true"} onClick={() => setRecipeCatDrop(false)} style={{
          position: "fixed",
          inset: 0,
          zIndex: 19
        }} />}<FilterDropdown
          id={"recipe-cat"}
          label={"Category"}
          shortLabel={"Category"}
          options={RECIPE_CATS.filter(c => c !== "All")}
          optionLabel={c => c}
          selected={recipeFilter}
          counts={recipeCatCounts}
          onToggle={cat => setRecipeFilter(sHas => {
            const n = new Set(sHas);
            n.has(cat) ? n.delete(cat) : n.add(cat);
            return n;
          })}
          open={!!recipeCatDrop}
          setOpen={v => setRecipeCatDrop(v === "recipe-cat")}
          accent={"#C4A044"}
          optionAccent={c => RECIPE_CAT_COLORS[c] || "#C4A044"}
          panelBorder={"rgba(196,148,40,0.25)"}
        />{recipeFilter.size > 0 && <button className={"btn btn-ghost btn-xs"} style={{
          fontSize: FS.sm,
          color: "#8a8478",
          alignSelf: "center"
        }} onClick={() => setRecipeFilter(new Set())}>{"Clear"}</button>}</div></div>{filteredTpls.length === 0 && <div className={"empty"}>{"No recipes match the selected categories."}</div>}{filteredTpls.map(tpl => {
      const xp = recipeXP(tpl, profile.chosenClass, allExById);
      const descExpanded = expandedRecipeDesc.has(tpl.id);
      const tplMgColor = getRecipeMgColor(tpl);
      const diffCls = tpl.difficulty ? `wo-diff-pill wo-diff-${tpl.difficulty.toLowerCase()}` : null;
      return <div key={tpl.id} className={"workout-card"} style={{
        marginBottom: S.s12,
        "--mg-color": tplMgColor
      }}><div className={"workout-card-top"}><div className={"workout-icon"}>{tpl.icon}</div><div style={{
            flex: 1,
            minWidth: 0
          }}><div className={"workout-name"}>{tpl.name}</div><div className={"workout-meta"}>{tpl.category && <span className={"wo-cat-pill"}>{tpl.category}</span>}{tpl.difficulty && <span className={diffCls}>{tpl.difficulty}</span>}<span className={"workout-tag"}>{tpl.exercises.length}{" ex"}</span><span className={"workout-tag"}>{formatXP(xp, {
                  prefix: "⚡ "
                })}</span>{tpl.durationMin && <span className={"workout-tag"}>{"⏱ "}{tpl.durationMin}{"min"}</span>}{tpl.equipment && <span className={"workout-tag"}>{EQUIP_ICONS[tpl.equipment] || ""}{" "}{tpl.equipment}</span>}</div></div></div>
        {
          /* Collapsible Description */
        }{tpl.desc && <div style={{
          position: "relative",
          marginBottom: descExpanded ? 10 : 4,
          marginTop: S.s6
        }}><div className={descExpanded ? "" : "recipe-desc-collapsed"} style={{
            fontSize: FS.lg,
            color: "#8a8478",
            fontStyle: "italic",
            lineHeight: 1.5,
            whiteSpace: "pre-line",
            paddingRight: 20
          }}>{tpl.desc}</div><span className={`ex-collapse-btn ${descExpanded ? "open" : ""}`} style={{
            position: "absolute",
            top: 0,
            right: 0,
            fontSize: FS.md,
            padding: "0 4px",
            cursor: "pointer"
          }} role={"button"} aria-label={descExpanded ? `Collapse ${tpl.name} description` : `Expand ${tpl.name} description`} onClick={() => setExpandedRecipeDesc(s => {
            const n = new Set(s);
            n.has(tpl.id) ? n.delete(tpl.id) : n.add(tpl.id);
            return n;
          })}>{"▼"}</span></div>
        /* Exercise breakdown — collapsible, collapsed by default */}<div style={{
          background: "rgba(45,42,36,.12)",
          border: "1px solid rgba(45,42,36,.18)",
          borderRadius: R.lg,
          padding: "8px 12px",
          marginBottom: S.s12,
          cursor: "pointer"
        }} onClick={() => setExpandedRecipeEx(s => {
          const n = new Set(s);
          n.has(tpl.id) ? n.delete(tpl.id) : n.add(tpl.id);
          return n;
        })}><div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}><span style={{
              fontSize: FS.fs68,
              color: "#8a8478"
            }}>{tpl.exercises.length}{" exercises"}</span><span className={`ex-collapse-btn ${expandedRecipeEx.has(tpl.id) ? "open" : ""}`} style={{
              fontSize: FS.fs65
            }}>{"▼"}</span></div>{expandedRecipeEx.has(tpl.id) && <div style={{
            marginTop: S.s8
          }}>{(() => {
              const list = normalizeSupersetGroups(tpl.exercises.map(e => ({ ...e })));
              const nodes = [];
              eachRun(list, (run, gid, start) => {
                if (gid) {
                  const letter = groupLetter(list, gid);
                  nodes.push(<div key={gid} className={"recipe-ss-group"} style={{
                    borderLeft: "2px solid #C4A044",
                    paddingLeft: 8,
                    marginBottom: S.s6,
                    marginTop: start > 0 ? 6 : 0
                  }}><div style={{
                      fontSize: FS.fs58,
                      color: "#C4A044",
                      fontWeight: 600,
                      marginBottom: S.s4,
                      textTransform: "uppercase",
                      letterSpacing: ".5px"
                    }}>{"🔗 Superset "}{letter}</div>{run.map((ex, k) => {
                      const exD = allExById[ex.exId];
                      if (!exD) return null;
                      const noSets = NO_SETS_EX_IDS.has(ex.exId);
                      return <div key={start + k} style={{
                        display: "flex",
                        alignItems: "center",
                        gap: S.s8,
                        padding: "3px 0"
                      }}><span style={{ fontSize: FS.fs90, flexShrink: 0 }}>{exD.icon}</span><span style={{ fontSize: FS.fs75, color: "#d4cec4", flex: 1 }}>{memberBadge(list, start + k)}{" · "}{exD.name}</span><span style={{ fontSize: FS.fs68, color: "#8a8478" }}>{noSets ? `${ex.reps} min` : `${ex.sets} × ${ex.reps}`}</span></div>;
                    })}</div>);
                  return;
                }
                run.forEach((ex, k) => {
                  const i = start + k;
                  const exD = allExById[ex.exId];
                  if (!exD) return;
                  const noSets = NO_SETS_EX_IDS.has(ex.exId);
                  nodes.push(<div key={i} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: S.s8,
                    padding: "4px 0",
                    borderBottom: i < list.length - 1 ? "1px solid rgba(45,42,36,.15)" : ""
                  }}><span style={{ fontSize: FS.fs90, flexShrink: 0 }}>{exD.icon}</span><span style={{ fontSize: FS.fs75, color: "#d4cec4", flex: 1 }}>{exD.name}</span><span style={{ fontSize: FS.fs68, color: "#8a8478" }}>{noSets ? `${ex.distanceMi ? ex.distanceMi + "mi · " : ""}${ex.reps} min` : `${ex.sets} × ${ex.reps}`}</span></div>);
                });
              });
              return nodes;
            })()}</div>}</div><div style={{
          display: "flex",
          gap: S.s8
        }}><button className={"btn btn-gold btn-sm"} style={{
            flex: 1
          }} onClick={() => {
            const wo = buildWorkoutObject({
              name: tpl.name,
              icon: tpl.icon,
              desc: tpl.desc,
              exercises: tpl.exercises.map(e => ({ ...e })),
              createdAt: new Date().toLocaleDateString()
            });
            setProfile(pr => ({
              ...pr,
              workouts: [...(pr.workouts || []), wo]
            }));
            setActiveWorkout(wo);
            setWorkoutView("detail");
            showToast(`${tpl.icon} ${tpl.name} added to your workouts!`);
          }}>{"＋ Add to My Workouts"}</button><button className={"btn btn-ghost btn-sm"} style={{
            flex: 1
          }} onClick={() => {
            setWbName(tpl.name);
            setWbIcon(tpl.icon);
            setWbDesc(tpl.desc);
            setWbIntensity("");
            setWbExercises(normalizeSupersetGroups(tpl.exercises.map(e => ({
              ...e
            }))));
            setWbEditId(null);
            setWorkoutView("builder");
          }}>{"✎ Duplicate"}</button></div></div>;
    })}</>;
}

// ── DETAIL ─────────────────────────────
if (workoutView === "detail" && activeWorkout) {
  const wo = activeWorkout;
  const xp = calcWorkoutXP(wo, profile.chosenClass, allExById);
  return <><div style={{
      display: "flex",
      alignItems: "center",
      gap: S.s8,
      marginBottom: S.s12
    }}><button className={"btn btn-ghost btn-sm"} onClick={() => {
        setWorkoutView("list");
        setActiveWorkout(null);
      }}>{"← Back"}</button><div style={{
        fontFamily: "'Cinzel',serif",
        fontSize: ".78rem",
        fontWeight: 600,
        color: "#d4cec4",
        letterSpacing: ".03em",
        flex: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>{wo.icon}{" "}{wo.name}</div><div style={{
        display: "flex",
        gap: S.s6,
        flexShrink: 0
      }}><button className={"btn btn-ghost btn-sm"} title={"Duplicate workout"} onClick={() => copyWorkout(wo)}>{"Duplicate"}</button><button className={"btn btn-ghost btn-sm"} onClick={() => initWorkoutBuilder(wo)}>{"✎ Edit"}</button></div></div>{wo.desc && <div style={{
      fontSize: FS.fs75,
      color: "#8a8478",
      fontStyle: "italic",
      marginBottom: S.s10
    }}>{wo.desc}</div>}<div style={{
      display: "flex",
      gap: S.s8,
      marginBottom: S.s14,
      flexWrap: "wrap"
    }}><IntensityChip value={wo.intensity} /><div className={"xp-projection"} style={{
        flex: 1,
        minWidth: 160,
        margin: 0,
        "--mg-color": clsColor || "#b4ac9e"
      }}><div><div className={"xp-proj-label"}>{"Total Projected XP"}</div><div className={"xp-proj-detail"}>{wo.exercises.length}{" exercises"}</div></div><div className={"xp-proj-value"}>{"⚡ "}{xp.toLocaleString()}</div></div></div><div className={"sec"} style={{
      marginBottom: S.s8
    }}>{"Exercises"}</div>{wo.exercises.map((ex, i) => {
      const exD = allExById[ex.exId];
      if (!exD) return null;
      const isC = exD.category === "cardio";
      const isF = exD.category === "flexibility";
      const showW = !isC && !isF;
      const exMgColor = getMuscleColor(exD.muscleGroup);
      return <div key={i} className={"workout-detail-ex"} style={{
        "--mg-color": exMgColor
      }}><div className={"workout-detail-ex-orb"}><ExIcon ex={exD} size={".95rem"} color={"#d4cec4"} /></div><div style={{
          flex: 1,
          minWidth: 0
        }}><div className={"workout-detail-ex-name"}>{exD.name}{exD.custom && <span className={"custom-ex-badge"} style={{
              marginLeft: S.s6
            }}>{"custom"}</span>}</div>{ex.exId !== "rest_day" && <div className={"workout-detail-ex-meta"}>{ex.sets}{"×"}{ex.reps}{isC || isF ? " min" : ""}{showW && ex.weightLbs ? <span style={{
              color: "#8a8478",
              marginLeft: S.s6
            }}>{metric ? lbsToKg(ex.weightLbs) + " kg" : ex.weightLbs + " lbs"}</span> : ""}</div>}</div><div style={{
          display: "flex",
          alignItems: "center",
          gap: S.s8
        }}>{exD.custom && <button className={"btn btn-ghost btn-xs"} title={"Edit custom exercise"} aria-label={`Edit ${exD.name}`} onClick={() => openExEditor("edit", exD)}>{"✎"}</button>}<div className={"workout-detail-ex-xp"}>{"+"}{calcExXP(ex.exId, ex.sets || 3, ex.reps || 10, profile.chosenClass, allExById)}{" XP"}</div></div></div>;
    })}<div className={"div"} /><div style={{
      display: "flex",
      gap: S.s8,
      flexWrap: "wrap"
    }}><button className={"btn btn-gold-solid"} style={{
        flex: 1,
        minHeight: 44
      }} onClick={() => startLiveWorkout(wo)}>{"Start"}</button><button className={"btn btn-gold"} style={{
        flex: 1,
        minHeight: 44
      }} onClick={() => openCompletionFlow(wo)}>{"Log"}</button><button className={"btn btn-ghost btn-sm"} style={{
        flex: 1
      }} onClick={() => setAddToPlanPicker({
        workout: wo
      })}>{"Add to Plan"}</button><button className={"btn btn-danger btn-sm"} style={{
        flex: 0,
        paddingLeft: 10,
        paddingRight: 10,
        minHeight: 44,
        minWidth: 44
      }} aria-label={"Delete workout"} onClick={() => deleteWorkout(wo.id)}>{"🗑"}</button></div></>;
}

// ── BUILDER ────────────────────────────
if (workoutView === "builder") return <><div className={"builder-nav-hdr"}><button className={"btn btn-ghost btn-sm"} onClick={requestLeaveBuilder}>{"← Cancel"}</button><div style={{
      flex: 1,
      minWidth: 0
    }}><div className={"builder-nav-title"}>{wbEditId ? "✎ Edit Workout" : wbCopySource ? "Duplicate Workout" : "New Workout"}</div>{wbCopySource && <div className={"builder-nav-sub"}>{"From: "}{wbCopySource}</div>}</div>{isActive && <WorkoutDetails name={wbName} notes={wbDesc} intensity={wbIntensity}
    availableLabels={profile.workoutLabels || []}
    session={{ labels: wbLabels, duration: wbDuration, durationSec: wbDurSec, activeCal: wbActiveCal, totalCal: wbTotalCal }}
    onSave={draft => {
      setWbName(draft.name); setWbDesc(draft.notes); setWbIntensity(draft.intensity);
      setWbLabels(draft.session.labels); setWbDuration(draft.session.duration); setWbDurSec(draft.session.durationSec);
      setWbActiveCal(draft.session.activeCal); setWbTotalCal(draft.session.totalCal);
      setProfile(p => {
        const labels = [...(p.workoutLabels || [])];
        for (const label of draft.session.labels) if (!labels.some(l => l.toLowerCase() === label.toLowerCase())) labels.push(label);
        return labels.length === (p.workoutLabels || []).length ? p : { ...p, workoutLabels: labels };
      });
    }} />}</div><div className={"wb-section wb-details-identity"}><div className={"field"}><label>{"Name "}<span className={"req-star"}>{"*"}</span></label><div className={"wb-identity-row"}><button type={"button"} className={"wb-icon-btn"} title={"Change icon"} aria-label={"Change workout icon"} aria-haspopup={"dialog"} aria-expanded={wbIconPickerOpen} onClick={() => setWbIconPickerOpen(v => !v)}>{wbIcon}<span className={"wb-icon-btn-caret"} aria-hidden={"true"}>{"▾"}</span></button><input className={"inp"} value={wbName} onChange={e => { setWbName(e.target.value); if (wbNameError) setWbNameError(""); }} placeholder={"e.g. Morning Push Day…"} aria-invalid={!!wbNameError} /></div>{wbNameError && <div className={"wb-name-error"}>{wbNameError}</div>}</div></div><Sheet open={wbIconPickerOpen} onClose={() => setWbIconPickerOpen(false)} layer={"modal"} placement={"center"} maxWidth={360} title={"Choose an icon"} ariaLabel={"Choose a workout icon"}><div className={"wb-icon-picker"} role={"group"} aria-label={"Workout icons"}>{["💪","🏋️","🔥","⚔️","🏃","🚴","🧘","⚡","🎯","🛡️","🏆","🌟","💥","🗡️","🥊","🤸","🏊","🎽","🦵","🦾","🏅","🥇","⛹️","🤼","🧗","🤾","🎿","🏄","⛷️","🚣","🏹","🏇","🌿","🫀","🦴","💨","🌊","🏔️","🌄","🐉","🦅","🔱","☀️","🌙","🌪️","💫","🎖️","⚒️","🧱","🥋"].map(ic => <button type={"button"} key={ic} aria-label={`Icon ${ic}`} aria-pressed={wbIcon === ic} className={`icon-opt ${wbIcon === ic ? "sel" : ""}`} onClick={() => { setWbIcon(ic); setWbIconPickerOpen(false); }}>{ic}</button>)}</div></Sheet>  {
    /* Exercise list */
  }<div className={"wo-section-hdr"} style={{
    marginTop: S.s18,
    marginBottom: S.s10
  }}><span className={"wo-section-hdr-text"}>{"Exercises"}</span></div><div style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: S.s8
  }}><label>{"("}{wbExercises.length}{" exercise"}{wbExercises.length !== 1 ? "s" : ""}{")"}{wbExercises.length > 0 && <span style={{
        marginLeft: S.s8,
        fontSize: FS.fs65,
        color: "#b4ac9e",
        fontFamily: "'Inter',sans-serif"
      }}>{"⚡ "}{formatXP(wbTotalXP)}{" total"}</span>}</label><div style={{
      display: "flex",
      gap: S.s6
    }}><button className={"btn btn-ghost btn-xs"} onClick={() => setWbExPickerOpen(true)}>{"＋ Add Exercise"}</button><button className={"btn btn-ghost btn-xs"} onClick={() => openExEditor("create", null)}>{"⚔ Forge Custom"}</button></div></div>{wbExercises.length === 0 && <div className={"empty"} style={{
    padding: "16px 0"
  }}>{"No exercises yet. Add from the list or create a custom one."}</div>}<div className={"wb-ex-list"} ref={wbListRef}><div className={"wb-drop-line"} aria-hidden={"true"}><div className={"dl-bar"} /><span className={"dl-plus"}>{"+"}</span></div>{(() => {
    const minSsChecked = ssChecked.size > 0 ? Math.min(...ssChecked) : -1;
    const joinGid = adjacentGroupId(wbExercises, [...ssChecked]);
    const joinLetter = joinGid ? groupLetter(wbExercises, joinGid) : "";
    const staging = ssChecked.size > 0 ? <SsStagingBar count={ssChecked.size} joinLetter={joinLetter} onGroup={() => {
      setWbExercises(xs => groupStaged(xs, [...ssChecked], joinGid));
      setSsChecked(new Set());
    }} onCancel={() => setSsChecked(new Set())} /> : null;
    const renderCard = (ex, i, inSs, isLast) => {
      const exD = allExById[ex.exId];
      if (!exD) return null;
      const grouped = !!ex.ssGroupId;
      const canMoveUp = grouped ? i > 0 && wbExercises[i - 1].ssGroupId === ex.ssGroupId : i > 0;
      const canMoveDown = grouped ? i < wbExercises.length - 1 && wbExercises[i + 1].ssGroupId === ex.ssGroupId : i < wbExercises.length - 1;
      return <div key={i + "_" + (ex.exId || "")} className={`wb-ex-row${inSs ? " in-ss" : ""}${isLast ? " ss-last" : ""}`} data-wb-idx={i} style={{
        flexDirection: "column",
        alignItems: "stretch",
        gap: S.s0,
        "--cat-color": getTypeColor(exD.category),
        "--mg-color": getMuscleColor(exD.muscleGroup)
      }}><WbExCard ex={ex} i={i} exD={exD} collapsed={!!collapsedWbEx[i]} profile={profile} allExById={allExById} metric={metric} setWbExercises={setWbExercises} setCollapsedWbEx={setCollapsedWbEx} setSsChecked={setSsChecked} ssChecked={ssChecked} exCount={wbExercises.length} openExEditor={openExEditor} canMoveUp={canMoveUp} canMoveDown={canMoveDown} grouped={grouped} orderBadge={grouped ? memberBadge(wbExercises, i) : null} /></div>;
    };
    const nodes = [];
    eachRun(wbExercises, (run, gid, start) => {
      if (gid) {
        const letter = groupLetter(wbExercises, gid);
        const last = start + run.length - 1;
        const totalXP = run.reduce((s, e) => s + calcExEntryXP(e, profile.chosenClass, allExById), 0);
        nodes.push(<div key={gid} className={"ss-run"}><div className={"ss-band"} aria-label={`Superset ${letter}, ${run.length} exercises`}><div className={"wb-reorder"}><IconButton label={`Move superset ${letter} up`} size={20} disabled={start === 0} onClick={() => reorderSupersetPair(gid, "up")}>{"▲"}</IconButton><IconButton label={`Move superset ${letter} down`} size={20} disabled={last === wbExercises.length - 1} onClick={() => reorderSupersetPair(gid, "down")}>{"▼"}</IconButton></div><span className={"ss-band-icon"} aria-hidden={"true"}>{"🔗"}</span><span className={"ss-accordion-hdr-title"}>{"Superset "}{letter}</span><span className={"ss-band-spacer"} /><span className={"ss-accordion-xp"}>{formatXP(totalXP) + " total"}</span><button type={"button"} className={"ss-accordion-ungroup"} onClick={() => {
            setWbExercises(xs => ungroup(xs, gid));
            setSsChecked(new Set());
          }}>{"✕ Ungroup"}</button></div>{run.map((ex, k) => renderCard(ex, start + k, true, k === run.length - 1))}</div>);
        return;
      }
      run.forEach((ex, k) => {
        const i = start + k;
        nodes.push(<React.Fragment key={"solo_" + i}>{i === minSsChecked ? staging : null}{renderCard(ex, i, false, false)}</React.Fragment>);
      });
    });
    return nodes;
  })()}</div><div className={"wb-footer"}>{wbIsOneOff ? wbEditId ?
  // Editing an existing scheduled one-off — save changes in place
  <button className={"btn btn-gold"} style={{
    flex: 1
  }} onClick={() => {
    if (!guardWbName()) return;
    if (wbExercises.length === 0) {
      showToast("Add at least one exercise.");
      return;
    }
    const updated = buildWorkoutObject({
      id: wbEditId,
      name: wbName.trim(),
      icon: wbIcon,
      desc: wbDesc.trim(),
      intensity: wbIntensity || undefined,
      exercises: normalizeSupersetGroups(wbExercises),
      createdAt: todayStr(),
      oneOff: true,
      labels: wbLabels,
      durationMin: combineHHMMSec(wbDuration, wbDurSec),
      activeCal: wbActiveCal,
      totalCal: wbTotalCal,
    });
    setProfile(p => ({
      ...p,
      workouts: (p.workouts || []).find(w => w.id === wbEditId) ? (p.workouts || []).map(w => w.id === wbEditId ? updated : w) : [...(p.workouts || []), updated],
      scheduledWorkouts: (p.scheduledWorkouts || []).map(sw => sw.sourceWorkoutId === wbEditId ? {
        ...sw,
        sourceWorkoutName: updated.name,
        sourceWorkoutIcon: updated.icon
      } : sw)
    }));
    setWorkoutView("list");
    setWbEditId(null);
    setWbIsOneOff(false);
    showToast(`⚡ "${updated.name}" updated!`);
  }}>{"💾 Save Changes"}</button> :
  // New one-off — proceed through stats prompt then to log/schedule
  <button className={"btn btn-gold"} style={{
    flex: 1
  }} onClick={() => {
    if (!guardWbName()) return;
    if (wbExercises.length === 0) {
      showToast("Add at least one exercise.");
      return;
    }
    const wo = buildWorkoutObject({
      name: wbName,
      icon: wbIcon,
      desc: wbDesc,
      intensity: wbIntensity,
      exercises: wbExercises,
      createdAt: todayStr(),
      oneOff: true,
      durationMin: combineHHMMSec(wbDuration, wbDurSec) || null,
      activeCal: wbActiveCal,
      totalCal: wbTotalCal,
      labels: wbLabels
    });
    openCompletionFlow(wo);
    setWorkoutView("list");
  }}>{"Log / Schedule"}</button> : wbEditId ? <>
  <button className={"btn btn-gold-solid"} style={{ flex: 1 }} onClick={() => { if (!guardWbName()) return; saveBuiltWorkout(); }}>{"Save Workout"}</button>
  <button className={"btn btn-ghost"} style={{ flex: 1 }} onClick={() => { if (!guardWbName()) return; saveAsNewWorkout(); }}>{"Duplicate"}</button>
  </> : <>
  <button className={"btn btn-gold-solid"} style={{ flex: 1 }} onClick={() => { if (!guardWbName()) return; saveBuiltWorkout(); }}>{"Save Workout"}</button>
  <button className={"btn btn-gold"} style={{
    flex: 1
  }} onClick={() => {
    if (!guardWbName()) return;
    if (wbExercises.length === 0) {
      showToast("Add at least one exercise.");
      return;
    }
    const wo = buildWorkoutObject({
      name: wbName,
      icon: wbIcon,
      desc: wbDesc,
      intensity: wbIntensity,
      exercises: wbExercises,
      createdAt: todayStr(),
      oneOff: true,
      durationMin: combineHHMMSec(wbDuration, wbDurSec) || null,
      activeCal: wbActiveCal,
      totalCal: wbTotalCal,
      labels: wbLabels
    });
    openCompletionFlow(wo);
    setWorkoutView("list");
  }}>{"Log / Schedule"}</button>
  </>}</div><ConfirmSheet
    open={confirmCancel}
    icon={"📝"}
    title={"Discard draft?"}
    body={"This workout has exercises. Cancel anyway and lose the draft?"}
    confirmLabel={"Discard"}
    danger
    onConfirm={leaveBuilder}
    onCancel={() => setConfirmCancel(false)}
  /></>;
return null;
});

export default WorkoutsTab;
