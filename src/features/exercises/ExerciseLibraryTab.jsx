import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { List } from 'react-window';
import { S, FS } from '../../utils/tokens';
import { useScrollRestore } from '../../hooks/useScrollRestore';
import TechSearch from './TechSearch';
import AnatomyMaps from './AnatomyMaps';
import LibraryExerciseCard from './LibraryExerciseCard';
import EquipIcon from './EquipIcons';
import { EQUIP_OPTS, muscleLabel, equipLabel } from './exerciseFilterOptions';
import { measureVisibleListHeight } from './visibleListHeight';
import { recentExerciseIds, resolveFavoriteExercises, HOME_ROW_COUNT } from './recentExercises';
import {
  DIFFICULTY_OPTS, GOAL_OPTS, GOAL_LABELS, MOVEMENT_OPTS, MOVEMENT_LABELS,
} from './libraryFacets';

const LIB_CARD_H = 108;
const TRAY_RESERVE = 72;

const LibExRow = React.memo(function LibExRow({
  ariaAttributes, index, style,
  exercises, cartSet, favSet, onOpen, onToggleCart, onToggleFav,
}) {
  const ex = exercises[index];
  if (!ex) return null;
  return (
    <div style={{ ...style, boxSizing: "border-box", overflow: "hidden", paddingBottom: 12 }} {...ariaAttributes}>
      <LibraryExerciseCard
        ex={ex}
        selected={cartSet.has(ex.id)}
        isFav={favSet.has(ex.id)}
        onToggleFav={onToggleFav}
        onToggleSelect={onToggleCart}
        onOpen={exObj => onOpen(exObj, "results")}
      />
    </div>
  );
});

function toggleInSet(setter, val) {
  setter(s => {
    const n = new Set(s);
    n.has(val) ? n.delete(val) : n.add(val);
    return n;
  });
}

function matchWord(n) {
  return n === 1 ? "match" : "matches";
}

function Chip({ active, onClick, children, ariaLabel }) {
  return (
    <button
      type="button"
      className={`ex-lib-chip${active ? " is-on" : ""}`}
      aria-pressed={!!active}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <span className="ex-lib-chip-check" aria-hidden="true">✓</span>
      {children}
    </button>
  );
}

const ExerciseLibraryTab = React.memo(function ExerciseLibraryTab(props) {
  const {
    libFiltered, libMuscleCardData, libEquipOpts,
    libMuscleCounts, libEquipCounts,
    libDifficultyCounts, libGoalCounts, libMovementCounts,
    setLibSearchDebounced,
    libTypeFilters, setLibTypeFilters,
    libMuscleFilters, setLibMuscleFilters,
    libEquipFilters, setLibEquipFilters,
    libDifficultyFilters, setLibDifficultyFilters,
    libGoalFilters, setLibGoalFilters,
    libMovementFilters, setLibMovementFilters,
    debouncedSetLibSearch,
    libSearchDebounced,
    setLibDetailEx,
    setLibDetailSiblings,
    cartIds, toggleCart, clearCart,
    profile, setProfile,
    allExercises, allExById,
    _exReady, _exLoadError,
    openExEditor,
    onSeeAllFavorites,
  } = props;

  const [catalogNoteDismissed, setCatalogNoteDismissed] = useState(false);
  const [search, setSearch] = useState(libSearchDebounced || "");
  const [libBrowseMode, setLibBrowseMode] = useState("home");
  const [recentNow] = useState(() => Date.now());
  const [focusToast, setFocusToast] = useState(null);

  useScrollRestore(`lib-${libBrowseMode}`);

  const rootRef = useRef(null);
  const listRef = useRef(null);
  const vlistWrapRef = useRef(null);
  const listSaveTimer = useRef(null);
  const LIST_SCROLL_KEY = "aurisar-scroll:lib-filtered-list";

  const cartSet = useMemo(() => new Set(cartIds), [cartIds]);
  const favSet = useMemo(() => new Set(profile.favoriteExercises || []), [profile.favoriteExercises]);

  const recentHome = useMemo(
    () => recentExerciseIds(profile.log, allExById, recentNow, HOME_ROW_COUNT).map(r => r.ex),
    [profile.log, allExById, recentNow]
  );
  const favHome = useMemo(
    () => resolveFavoriteExercises(profile.favoriteExercises, allExById, HOME_ROW_COUNT),
    [profile.favoriteExercises, allExById]
  );

  const allSiblings = useMemo(
    () => (allExercises || []).filter(e => e && e.id !== "rest_day"),
    [allExercises]
  );

  const muscleCountsByGroup = useMemo(() => {
    const m = new Map();
    for (const d of libMuscleCardData || []) m.set(d.mg, d.count);
    return m;
  }, [libMuscleCardData]);

  const selectedMuscle = [...libMuscleFilters][0] || null;
  const selectedMuscleCount = selectedMuscle
    ? (muscleCountsByGroup.get(selectedMuscle) || libMuscleCounts.get(selectedMuscle) || 0)
    : allSiblings.length;

  const saveListScroll = useCallback(() => {
    if (listSaveTimer.current) return;
    listSaveTimer.current = setTimeout(() => {
      listSaveTimer.current = null;
      const el = listRef.current?.element;
      if (el) { try { sessionStorage.setItem(LIST_SCROLL_KEY, String(el.scrollTop)); } catch { /* private mode */ } }
    }, 120);
  }, []);

  useEffect(() => {
    if (libBrowseMode !== "results") return undefined;
    let saved = 0;
    try { saved = parseInt(sessionStorage.getItem(LIST_SCROLL_KEY) || "0", 10) || 0; } catch { /* ignore */ }
    if (saved <= 0) return undefined;
    let cancelled = false;
    const timers = [40, 120, 260, 500].map(d => setTimeout(() => {
      if (cancelled) return;
      const el = listRef.current?.element;
      if (el && el.scrollHeight > el.clientHeight && Math.abs(el.scrollTop - saved) > 2) el.scrollTop = saved;
    }, d));
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [libBrowseMode]);

  useLayoutEffect(() => {
    const scroller = rootRef.current?.closest(".scroll-area");
    if (!scroller) return undefined;
    if (libBrowseMode === "results") {
      scroller.classList.add("lib-list-locked");
      return () => scroller.classList.remove("lib-list-locked");
    }
    scroller.classList.remove("lib-list-locked");
    return undefined;
  }, [libBrowseMode]);

  useLayoutEffect(() => {
    if (libBrowseMode !== "results") return undefined;
    const wrap = vlistWrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return undefined;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const top = wrap.getBoundingClientRect().top;
      const nav = document.querySelector(".hud-nav-panel");
      const navTop = nav ? nav.getBoundingClientRect().top : Infinity;
      const tray = document.querySelector(".ex-lib-tray");
      const trayTop = tray ? tray.getBoundingClientRect().top : Infinity;
      const h = measureVisibleListHeight({
        wrapTop: top,
        navTop: Number.isFinite(trayTop) ? Math.min(navTop, trayTop) : navTop,
        visualViewport: window.visualViewport,
        innerHeight: window.innerHeight,
        gap: cartIds.length ? 12 : 6,
      });
      wrap.style.height = h + "px";
      wrap.style.maxHeight = h + "px";
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);
    const nav = document.querySelector(".hud-nav-panel");
    if (nav) ro.observe(nav);
    const trayEl = document.querySelector(".ex-lib-tray");
    if (trayEl) ro.observe(trayEl);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', schedule);
      vv.addEventListener('scroll', schedule);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      if (vv) {
        vv.removeEventListener("resize", schedule);
        vv.removeEventListener("scroll", schedule);
      }
      if (wrap) { wrap.style.height = ""; wrap.style.maxHeight = ""; }
    };
  }, [libBrowseMode, cartIds.length]);

  useEffect(() => () => clearTimeout(listSaveTimer.current), []);

  const clearFacetFilters = () => {
    setLibTypeFilters(new Set());
    setLibMuscleFilters(new Set());
    setLibEquipFilters(new Set());
    setLibDifficultyFilters(new Set());
    setLibGoalFilters(new Set());
    setLibMovementFilters(new Set());
  };

  const clearAll = () => {
    debouncedSetLibSearch.cancel?.();
    clearFacetFilters();
    setSearch("");
    setLibSearchDebounced("");
    setFocusToast(null);
    setLibBrowseMode("home");
  };

  const toggleFav = useCallback(id => setProfile(p => ({
    ...p,
    favoriteExercises: (p.favoriteExercises || []).includes(id)
      ? (p.favoriteExercises || []).filter(i => i !== id)
      : [...(p.favoriteExercises || []), id]
  })), [setProfile]);

  const goCreate = () => openExEditor?.("create", null);

  const submitSearch = v => {
    const q = (v ?? search).trim();
    debouncedSetLibSearch.cancel?.();
    setLibSearchDebounced(q);
    if (q) setLibBrowseMode("results");
  };

  const clearSearch = () => {
    debouncedSetLibSearch.cancel?.();
    setSearch("");
    setLibSearchDebounced("");
  };

  const openDetail = useCallback((ex, source) => {
    const siblings = source === "recent" ? allSiblings : libFiltered;
    setLibDetailSiblings?.(siblings);
    setLibDetailEx(ex);
  }, [allSiblings, libFiltered, setLibDetailEx, setLibDetailSiblings]);

  const chooseMuscle = mg => {
    setLibMuscleFilters(new Set([mg]));
    setFocusToast({ label: muscleLabel(mg), count: muscleCountsByGroup.get(mg) || 0 });
    setLibBrowseMode("filters");
  };

  const browseAll = () => {
    setLibMuscleFilters(new Set());
    setFocusToast({ label: "All", count: allSiblings.length });
    setLibBrowseMode("filters");
  };

  const resultChipText = () => {
    const parts = [];
    if (selectedMuscle) parts.push(muscleLabel(selectedMuscle));
    if (libEquipFilters.size === 1) parts.push(equipLabel([...libEquipFilters][0]));
    else if (libEquipFilters.size > 1) parts.push(`${libEquipFilters.size} equip`);
    if (libMovementFilters.size === 1) parts.push(MOVEMENT_LABELS[[...libMovementFilters][0]]);
    if (search.trim()) parts.push(`“${search.trim()}”`);
    return parts.length ? parts.join(" · ") : "All";
  };

  const n = libFiltered.length;
  const equipOptions = (libEquipOpts && libEquipOpts.length) ? libEquipOpts : EQUIP_OPTS;

  return (
    <div
      ref={rootRef}
      className={`ex-lib lib-tab-root${libBrowseMode === "results" ? " lib-tab-root--filtered" : ""}`}
    >
      <div className="lib-sticky-search ex-lib-search-row">
        <TechSearch
          id="lib-search"
          label={"Search exercises"}
          value={search}
          onChange={setSearch}
          onClear={clearSearch}
          onSubmit={submitSearch}
          placeholder="Search by name"
          submitLabel="Search"
        />
        {libBrowseMode === "home" && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={goCreate} style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
            Create
          </button>
        )}
      </div>

      {!_exReady && <div className="lib-catalog-note" role="status">
        <span className="lib-catalog-spinner" aria-hidden="true" />
        Loading the full catalog…
      </div>}
      {_exReady && _exLoadError && !catalogNoteDismissed && <div className="lib-catalog-note lib-catalog-note-warn" role="status">
        <span aria-hidden="true">⚠</span>
        <span style={{ flex: 1 }}>{`Showing the offline catalog (${allExercises.length} exercises) — couldn't reach the server, so newer additions may be missing.`}</span>
        <button type="button" onClick={() => setCatalogNoteDismissed(true)} aria-label="Dismiss" style={{
          background: "transparent", border: "none", color: "inherit",
          cursor: "pointer", fontSize: FS.fs78, lineHeight: 1, padding: S.s2
        }}>✕</button>
      </div>}

      {libBrowseMode === "home" && (
        <div className="ex-lib-screen">
          <div className="ex-lib-step">Choose a focus.</div>
          <h2 className="ex-lib-heading">What are you training?</h2>
          <p className="ex-lib-sub">Tap a muscle on the map to start narrowing.</p>

          <div className={`ex-lib-focus-card${selectedMuscle ? " has-selection" : ""}`}>
            <span className="ex-lib-corner tl" aria-hidden="true" />
            <span className="ex-lib-corner tr" aria-hidden="true" />
            <span className="ex-lib-corner bl" aria-hidden="true" />
            <span className="ex-lib-corner br" aria-hidden="true" />
            <AnatomyMaps
              selectedMuscle={selectedMuscle}
              onSelect={chooseMuscle}
              counts={muscleCountsByGroup}
              toastLabel={focusToast?.label || (selectedMuscle && muscleLabel(selectedMuscle))}
              toastCount={focusToast?.count ?? (selectedMuscle ? selectedMuscleCount : null)}
            />
            <div className="ex-lib-quick-picks">
              <button type="button" className="ex-lib-qchip" onClick={browseAll}>
                Browse all <span className="count">{allSiblings.length}</span>
              </button>
            </div>
            <div className="ex-lib-or">— or search by name above —</div>
          </div>

          {recentHome.length > 0 && (
            <section className="ex-lib-recent">
              <div className="ex-lib-row-heading">Recent</div>
              <div className="ex-lib-recent-list">
                {recentHome.map(ex => (
                  <LibraryExerciseCard
                    key={ex.id}
                    ex={ex}
                    variant="recent"
                    selected={cartSet.has(ex.id)}
                    isFav={favSet.has(ex.id)}
                    onToggleFav={toggleFav}
                    onToggleSelect={toggleCart}
                    onOpen={exObj => openDetail(exObj, "recent")}
                  />
                ))}
              </div>
            </section>
          )}

          {favHome.length > 0 && (
            <section className="ex-lib-recent">
              <div className="ex-lib-section-head">
                <div className="ex-lib-row-heading" style={{ flex: 1, paddingRight: 0 }}>Favorites</div>
                {onSeeAllFavorites && (profile.favoriteExercises || []).length > HOME_ROW_COUNT && (
                  <button type="button" className="lib-see-all btn-sm" onClick={onSeeAllFavorites}>See All</button>
                )}
              </div>
              <div className="ex-lib-recent-list">
                {favHome.map(ex => (
                  <LibraryExerciseCard
                    key={ex.id}
                    ex={ex}
                    variant="recent"
                    selected={cartSet.has(ex.id)}
                    isFav={favSet.has(ex.id)}
                    onToggleFav={toggleFav}
                    onToggleSelect={toggleCart}
                    onOpen={exObj => openDetail(exObj, "recent")}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {libBrowseMode === "filters" && (
        <div className="ex-lib-screen ex-lib-filters">
          <div className="ex-lib-filters-head">
            <button type="button" className="ex-lib-icon-btn" aria-label="Back to focus" onClick={() => setLibBrowseMode("home")}>←</button>
            <h2 className="ex-lib-heading ex-lib-heading--sm">Filters</h2>
            <div className="ex-lib-count" role="status" aria-live="polite">
              <span className="n">{n}</span>
              <span className="l">{matchWord(n)}</span>
            </div>
          </div>

          <div className="ex-lib-focus-summary">
            <div className="ex-lib-fs-icon" aria-hidden="true"><EquipIcon equipment="barbell" size={20} /></div>
            <div className="ex-lib-fs-body">
              <div className="ex-lib-fs-label">Selected focus</div>
              <div className="ex-lib-fs-value">
                {selectedMuscle ? muscleLabel(selectedMuscle) : "All exercises"}
                <span className="ex-lib-fs-count">{selectedMuscleCount} ex</span>
              </div>
            </div>
            <button type="button" className="ex-lib-link-btn" onClick={() => setLibBrowseMode("home")}>Change</button>
          </div>

          <section className="ex-lib-filter-section">
            <h3 className="ex-lib-filter-title">Equipment</h3>
            <div className="ex-lib-chip-grid">
              {equipOptions.map(eq => {
                const count = libEquipCounts.get(eq) || 0;
                const active = libEquipFilters.has(eq);
                return (
                  <Chip
                    key={eq}
                    active={active}
                    ariaLabel={`${equipLabel(eq)}, ${count} exercises`}
                    onClick={() => toggleInSet(setLibEquipFilters, eq)}
                  >
                    <span className="ex-lib-chip-icon"><EquipIcon equipment={eq} size={14} /></span>
                    {equipLabel(eq)}
                    <span className="ex-lib-chip-count">{count}</span>
                  </Chip>
                );
              })}
            </div>
          </section>

          <section className="ex-lib-filter-section">
            <h3 className="ex-lib-filter-title">Difficulty</h3>
            <div className="ex-lib-chip-grid">
              {DIFFICULTY_OPTS.map(d => {
                const count = libDifficultyCounts?.get(d) || 0;
                return (
                  <Chip
                    key={d}
                    active={libDifficultyFilters.has(d)}
                    ariaLabel={`${d}, ${count} exercises`}
                    onClick={() => toggleInSet(setLibDifficultyFilters, d)}
                  >
                    {d} <span className="ex-lib-chip-count">{count}</span>
                  </Chip>
                );
              })}
            </div>
          </section>

          <section className="ex-lib-filter-section">
            <h3 className="ex-lib-filter-title">Goal</h3>
            <div className="ex-lib-chip-grid">
              {GOAL_OPTS.map(g => {
                const count = libGoalCounts?.get(g) || 0;
                return (
                  <Chip
                    key={g}
                    active={libGoalFilters.has(g)}
                    ariaLabel={`${GOAL_LABELS[g]}, ${count} exercises`}
                    onClick={() => toggleInSet(setLibGoalFilters, g)}
                  >
                    {GOAL_LABELS[g]} <span className="ex-lib-chip-count">{count}</span>
                  </Chip>
                );
              })}
            </div>
          </section>

          <section className="ex-lib-filter-section">
            <h3 className="ex-lib-filter-title">Movement</h3>
            <div className="ex-lib-chip-grid">
              {MOVEMENT_OPTS.map(m => {
                const count = libMovementCounts?.get(m) || 0;
                return (
                  <Chip
                    key={m}
                    active={libMovementFilters.has(m)}
                    ariaLabel={`${MOVEMENT_LABELS[m]}, ${count} exercises`}
                    onClick={() => toggleInSet(setLibMovementFilters, m)}
                  >
                    {MOVEMENT_LABELS[m]} <span className="ex-lib-chip-count">{count}</span>
                  </Chip>
                );
              })}
            </div>
          </section>

          <p className="ex-lib-helper">Pick a filter or two — keep it under 30 exercises to stay focused.</p>

          <div className="ex-lib-sticky-bar">
            <button type="button" className="ex-lib-ghost-btn" onClick={() => {
              setLibEquipFilters(new Set());
              setLibDifficultyFilters(new Set());
              setLibGoalFilters(new Set());
              setLibMovementFilters(new Set());
              setLibTypeFilters(new Set());
            }}>Clear</button>
            <button type="button" className="ex-lib-primary-btn" onClick={() => setLibBrowseMode("results")}>
              Show {n} {n === 1 ? "exercise" : "exercises"}
            </button>
          </div>
        </div>
      )}

      {libBrowseMode === "results" && (
        <div className="ex-lib-results lib-filtered-view">
          <div className="ex-lib-results-head">
            <button type="button" className="ex-lib-icon-btn" aria-label="Back to filters" onClick={() => setLibBrowseMode("filters")}>←</button>
            <button
              type="button"
              className="ex-lib-active-chip"
              onClick={() => setLibBrowseMode("filters")}
            >
              <span>{resultChipText()}</span>
              <span className="x" aria-hidden="true">×</span>
            </button>
            <div className="ex-lib-count" role="status" aria-live="polite">
              <span className="n">{n}</span>
              <span className="l">{matchWord(n)}</span>
            </div>
          </div>

          <div className="lib-vlist-wrap" ref={vlistWrapRef}>
            {n === 0
              ? (_exReady
                ? <div className="empty lib-empty" style={{ padding: "24px 0" }}>
                    <div>No exercises match.</div>
                    <div className="lib-empty-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                        setLibEquipFilters(new Set());
                        setLibDifficultyFilters(new Set());
                        setLibGoalFilters(new Set());
                        setLibMovementFilters(new Set());
                        setLibTypeFilters(new Set());
                        if (!selectedMuscle) setLibBrowseMode("filters");
                      }}>Clear filters</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>Start over</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={goCreate}>Create exercise</button>
                    </div>
                  </div>
                : <div aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div key={"skel" + i} className="lib-skel-row">
                    <div className="lib-skel-orb" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="lib-skel-line" style={{ width: `${68 - i * 5}%`, marginBottom: S.s6 }} />
                      <div className="lib-skel-line" style={{ width: `${44 - i * 3}%`, height: 7 }} />
                    </div>
                  </div>)}</div>)
              : (n > 60
                ? <List
                    listRef={listRef}
                    rowCount={libFiltered.length}
                    rowHeight={LIB_CARD_H}
                    rowComponent={LibExRow}
                    rowProps={{
                      exercises: libFiltered,
                      cartSet, favSet,
                      onOpen: openDetail,
                      onToggleCart: toggleCart,
                      onToggleFav: toggleFav,
                    }}
                    overscanCount={6}
                    onScroll={saveListScroll}
                    style={{ height: "100%", width: "100%", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}
                  />
                : <div className="ex-lib-recent-list" style={{ paddingBottom: cartIds.length ? TRAY_RESERVE : 12, overflowY: "auto", height: "100%" }}>
                    {libFiltered.map(ex => (
                      <LibraryExerciseCard
                        key={ex.id}
                        ex={ex}
                        selected={cartSet.has(ex.id)}
                        isFav={favSet.has(ex.id)}
                        onToggleFav={toggleFav}
                        onToggleSelect={toggleCart}
                        onOpen={exObj => openDetail(exObj, "results")}
                      />
                    ))}
                  </div>)}
          </div>
          {cartIds.length > 0 && (
            <div className="ex-lib-tray" role="status">
              <div className="ex-lib-tray-icon" aria-hidden="true">✓</div>
              <div className="ex-lib-tray-body">
                <div className="ex-lib-tray-title">
                  Added <span className="count">{cartIds.length}</span> {cartIds.length === 1 ? "exercise" : "exercises"}
                </div>
                <div className="ex-lib-tray-sub">Not yet in a workout</div>
              </div>
              <button type="button" className="ex-lib-link-btn" onClick={clearCart}>Clear</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default ExerciseLibraryTab;
export { LIB_CARD_H, TRAY_RESERVE };
