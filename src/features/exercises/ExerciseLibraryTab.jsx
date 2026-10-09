import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { List } from 'react-window';
import { ExIcon } from '../../components/ExIcon';
import { getMuscleColor, getTypeColor } from '../../utils/xp';
import { S, FS, Z } from '../../utils/tokens';
import { useScrollRestore } from '../../hooks/useScrollRestore';
import FilterDropdown from './FilterDropdown';
import ExerciseRow from './ExerciseRow';
import TechSearch from './TechSearch';
import { TYPE_OPTS, TYPE_LABELS, muscleLabel, equipLabel } from './exerciseFilterOptions';
import { measureVisibleListHeight } from './visibleListHeight';
import { SHOW_EXERCISE_PB_DISPLAY } from './showExercisePbDisplay';
import { recentExerciseIds, resolveFavoriteExercises, HOME_ROW_COUNT } from './recentExercises';
import { EX_ROW_H, EX_ROW_SLOT_PAD_Y } from './exerciseRowLayout';

const STEEL = "#B0A898";

const LibExRow = React.memo(function LibExRow({
  ariaAttributes, index, style,
  exercises, cartSet, favSet, pbSet, onOpen, onToggleCart, onToggleFav,
}) {
  const ex = exercises[index];
  if (!ex) return null;
  return (
    <div style={{ ...style, boxSizing: "border-box", overflow: "hidden", paddingTop: EX_ROW_SLOT_PAD_Y, paddingBottom: EX_ROW_SLOT_PAD_Y }} {...ariaAttributes}>
      <ExerciseRow
        ex={ex}
        selected={cartSet.has(ex.id)}
        showEquipment
        showPB={pbSet.has(ex.id)}
        isFav={favSet.has(ex.id)}
        onToggleFav={onToggleFav}
        onToggleSelect={onToggleCart}
        onActivate={() => onOpen(ex)}
      />
    </div>
  );
});

const HomeExList = React.memo(function HomeExList({
  items, cartSet, favSet, pbSet, onOpen, onToggleCart, onToggleFav,
}) {
  return (
    <div className={"lib-home-rows"}>
      {items.map(ex => (
        <ExerciseRow
          key={ex.id}
          ex={ex}
          selected={cartSet.has(ex.id)}
          showEquipment
          showPB={pbSet.has(ex.id)}
          isFav={favSet.has(ex.id)}
          onToggleFav={onToggleFav}
          onToggleSelect={onToggleCart}
          onActivate={() => onOpen(ex)}
        />
      ))}
    </div>
  );
});

const ExerciseLibraryTab = React.memo(function ExerciseLibraryTab(props) {
  const {
    libFiltered, libMuscleCardData, libMuscleOpts, libEquipOpts,
    libTypeCounts, libMuscleCounts, libEquipCounts,
    setLibSearchDebounced,
    libTypeFilters, setLibTypeFilters,
    libMuscleFilters, setLibMuscleFilters,
    libEquipFilters, setLibEquipFilters,
    debouncedSetLibSearch,
    setLibDetailEx,
    cartIds, toggleCart,
    profile, setProfile,
    allExercises, allExById,
    _exReady, _exLoadError,
    openExEditor,
    onSeeAllFavorites,
  } = props;

  const [catalogNoteDismissed, setCatalogNoteDismissed] = useState(false);
  const [search, setSearch] = useState("");
  const [libOpenDrop, setLibOpenDrop] = useState(null);
  const [libBrowseMode, setLibBrowseMode] = useState("home");
  const [recentNow] = useState(() => Date.now());

  useScrollRestore(`lib-${libBrowseMode}`);

  const rootRef = useRef(null);
  const listRef = useRef(null);
  const vlistWrapRef = useRef(null);
  const listSaveTimer = useRef(null);
  const LIB_ROW_H = EX_ROW_H;
  const LIST_SCROLL_KEY = 'aurisar-scroll:lib-filtered-list';

  const cartSet = useMemo(() => new Set(cartIds), [cartIds]);
  const favSet = useMemo(() => new Set(profile.favoriteExercises || []), [profile.favoriteExercises]);
  const pbSet = useMemo(
    () => SHOW_EXERCISE_PB_DISPLAY ? new Set(Object.keys(profile.exercisePBs || {})) : new Set(),
    [profile.exercisePBs],
  );

  const recentHome = useMemo(
    () => recentExerciseIds(profile.log, allExById, recentNow, HOME_ROW_COUNT).map(r => r.ex),
    [profile.log, allExById, recentNow]
  );
  const favHome = useMemo(
    () => resolveFavoriteExercises(profile.favoriteExercises, allExById, HOME_ROW_COUNT),
    [profile.favoriteExercises, allExById]
  );

  const saveListScroll = useCallback(() => {
    if (listSaveTimer.current) return;
    listSaveTimer.current = setTimeout(() => {
      listSaveTimer.current = null;
      const el = listRef.current?.element;
      if (el) { try { sessionStorage.setItem(LIST_SCROLL_KEY, String(el.scrollTop)); } catch { /* private mode */ } }
    }, 120);
  }, []);

  useEffect(() => {
    if (libBrowseMode !== 'filtered') return undefined;
    let saved = 0;
    try { saved = parseInt(sessionStorage.getItem(LIST_SCROLL_KEY) || '0', 10) || 0; } catch { /* ignore */ }
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
    const scroller = rootRef.current?.closest('.scroll-area');
    if (!scroller) return undefined;
    if (libBrowseMode === 'filtered') {
      scroller.classList.add('lib-list-locked');
      return () => scroller.classList.remove('lib-list-locked');
    }
    scroller.classList.remove('lib-list-locked');
    return undefined;
  }, [libBrowseMode]);

  useLayoutEffect(() => {
    if (libBrowseMode !== 'filtered') return undefined;
    const wrap = vlistWrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return undefined;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const top = wrap.getBoundingClientRect().top;
      const nav = document.querySelector('.hud-nav-panel');
      const navTop = nav ? nav.getBoundingClientRect().top : Infinity;
      const h = measureVisibleListHeight({
        wrapTop: top,
        navTop,
        visualViewport: window.visualViewport,
        innerHeight: window.innerHeight,
      });
      wrap.style.height = h + 'px';
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);
    const nav = document.querySelector('.hud-nav-panel');
    if (nav) ro.observe(nav);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', schedule);
      vv.addEventListener('scroll', schedule);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      if (vv) {
        vv.removeEventListener('resize', schedule);
        vv.removeEventListener('scroll', schedule);
      }
      if (wrap) wrap.style.height = '';
    };
  }, [libBrowseMode]);

  useEffect(() => () => clearTimeout(listSaveTimer.current), []);

  const toggleSet = (setter, val) => {
    setter(s => {
      const n = new Set(s);
      n.has(val) ? n.delete(val) : n.add(val);
      return n;
    });
  };
  const clearAll = () => {
    debouncedSetLibSearch.cancel?.();
    setLibTypeFilters(new Set());
    setLibMuscleFilters(new Set());
    setLibEquipFilters(new Set());
    setSearch("");
    setLibSearchDebounced("");
    setLibBrowseMode("home");
  };
  const hasFilters = libTypeFilters.size > 0 || libMuscleFilters.size > 0 || libEquipFilters.size > 0 || !!search;
  const activeFilterCount = libTypeFilters.size + libMuscleFilters.size + libEquipFilters.size;
  const trimmedSearch = search.trim();
  const hasResumeState = activeFilterCount > 0 || trimmedSearch.length > 0;
  const resumeSummary = [
    activeFilterCount > 0 ? `${activeFilterCount} filter${activeFilterCount !== 1 ? "s" : ""}` : null,
    trimmedSearch ? `“${trimmedSearch}”` : null,
  ].filter(Boolean).join(" · ");

  const MUSCLE_OPTS = libMuscleOpts;
  const EQUIP_OPTS = libEquipOpts;

  const toggleFav = useCallback(id => setProfile(p => ({
    ...p,
    favoriteExercises: (p.favoriteExercises || []).includes(id)
      ? (p.favoriteExercises || []).filter(i => i !== id)
      : [...(p.favoriteExercises || []), id]
  })), [setProfile]);

  const goCreate = () => openExEditor?.("create", null);

  const applySearch = v => {
    setSearch(v);
    debouncedSetLibSearch(v);
    if (v && libBrowseMode === "home") setLibBrowseMode("filtered");
  };
  const clearSearch = () => {
    debouncedSetLibSearch.cancel?.();
    setSearch("");
    setLibSearchDebounced("");
    if (libMuscleFilters.size === 0 && libTypeFilters.size === 0 && libEquipFilters.size === 0) {
      setLibBrowseMode("home");
    }
  };

  const homeRowProps = useMemo(() => ({
    cartSet, favSet, pbSet,
    onOpen: setLibDetailEx,
    onToggleCart: toggleCart,
    onToggleFav: toggleFav,
  }), [cartSet, favSet, pbSet, setLibDetailEx, toggleCart, toggleFav]);

  return <div ref={rootRef} className={libBrowseMode === "filtered" ? "lib-tab-root lib-tab-root--filtered" : "lib-tab-root"}>
    <div className={"lib-sticky-search"}>
      <div style={{ display: "flex", gap: S.s8, alignItems: "center" }}>
        <TechSearch
          id={"lib-search"}
          label={"Search exercises"}
          value={search}
          onChange={applySearch}
          onClear={clearSearch}
          placeholder={"Search…"}
        />
        {libBrowseMode === "home" && (
          <button
            type="button"
            className={"btn btn-ghost btn-sm"}
            onClick={goCreate}
            style={{ flexShrink: 0, whiteSpace: "nowrap" }}
          >{"Create"}</button>
        )}
      </div>
    </div>
    {!_exReady && <div className={"lib-catalog-note"} role="status">
      <span className={"lib-catalog-spinner"} aria-hidden="true" />
      {"Loading the full catalog…"}
    </div>}
    {_exReady && _exLoadError && !catalogNoteDismissed && <div className={"lib-catalog-note lib-catalog-note-warn"} role="status">
      <span aria-hidden="true">{"⚠"}</span>
      <span style={{ flex: 1 }}>{`Showing the offline catalog (${allExercises.length} exercises) — couldn't reach the server, so newer additions may be missing.`}</span>
      <button type="button" onClick={() => setCatalogNoteDismissed(true)} aria-label="Dismiss" style={{
        background: "transparent", border: "none", color: "inherit",
        cursor: "pointer", fontSize: FS.fs78, lineHeight: 1, padding: S.s2
      }}>{"✕"}</button>
    </div>}

    {libBrowseMode === "home" && <div>
      {hasResumeState && <div className={"lib-resume-chip"}>
        <button
          type={"button"}
          className={"lib-resume-chip-go"}
          onClick={() => setLibBrowseMode("filtered")}
        >
          <span className={"lib-resume-chip-label"}>{`${resumeSummary} — View ${libFiltered.length} result${libFiltered.length !== 1 ? "s" : ""}`}</span>
        </button>
        <button
          type={"button"}
          className={"lib-resume-chip-x"}
          aria-label={"Clear filters and search"}
          onClick={clearAll}
        >{"✕"}</button>
      </div>}

      <div className={"lib-home-section"}>
        <div className={"lib-section-hdr"}>{"Browse by muscle"}</div>
        <div className={"lib-muscle-grid"}>
          {libMuscleCardData.map(({ mg, label, count, color }) => (
            <button
              type="button"
              key={"mc-" + mg}
              className={"lib-muscle-tile"}
              aria-label={`${label}, ${count} exercises`}
              onClick={() => {
                setLibMuscleFilters(new Set([mg]));
                setLibBrowseMode("filtered");
              }}
              style={{ '--mg-color': color }}
            >
              <div className={"lib-tile-orb"} style={{ '--mg-color': color }}>
                <ExIcon ex={{ muscleGroup: mg, category: "strength" }} size={"0.95rem"} color={color} />
              </div>
              <div>
                <div className={"lib-tile-name"}>{label}</div>
                <div className={"lib-tile-count"} style={{ '--mg-color': color }}>{count}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {recentHome.length > 0 && <div className={"lib-home-section lib-home-section--compact"}>
        <div className={"lib-section-hdr"}>{"Recent"}</div>
        <HomeExList items={recentHome} {...homeRowProps} />
      </div>}

      {favHome.length > 0 && <div className={"lib-home-section lib-home-section--compact"}>
        <div className={"lib-home-section-head"}>
          <span className={"lib-section-hdr"} style={{ marginBottom: 0 }}>{"Favorites"}</span>
          {onSeeAllFavorites && (profile.favoriteExercises || []).length > HOME_ROW_COUNT && (
            <button type="button" className={"lib-see-all btn-sm"} onClick={onSeeAllFavorites}>{"See All"}</button>
          )}
        </div>
        <HomeExList items={favHome} {...homeRowProps} />
      </div>}
    </div>}

    {libBrowseMode === "filtered" && <div className={"lib-filtered-view"}>
      <div className={"lib-filtered-back"}>
        <button type="button" className={"lib-back-btn"} onClick={() => setLibBrowseMode("home")}>
          {"← Library"}
        </button>
        <button type="button" className={"btn btn-ghost btn-sm"} onClick={goCreate}>{"Create exercise"}</button>
      </div>

      <div className={"lib-filter-row"}>
        {libOpenDrop && <div aria-hidden={"true"} onClick={() => setLibOpenDrop(null)} style={{
          position: "fixed",
          inset: 0,
          zIndex: Z.scrim
        }} />}
        <FilterDropdown
          id="type"
          label="Type"
          shortLabel="Type"
          options={TYPE_OPTS}
          optionLabel={v => TYPE_LABELS[v]}
          selected={libTypeFilters}
          counts={libTypeCounts}
          onToggle={v => toggleSet(setLibTypeFilters, v)}
          open={libOpenDrop === "type"}
          setOpen={setLibOpenDrop}
          accent={STEEL}
          optionAccent={getTypeColor}
        />
        <FilterDropdown
          id="muscle"
          label="Muscle"
          shortLabel="Muscle"
          options={MUSCLE_OPTS}
          optionLabel={muscleLabel}
          selected={libMuscleFilters}
          counts={libMuscleCounts}
          onToggle={m => toggleSet(setLibMuscleFilters, m)}
          open={libOpenDrop === "muscle"}
          setOpen={setLibOpenDrop}
          accent={STEEL}
          optionAccent={getMuscleColor}
        />
        <FilterDropdown
          id="equip"
          label="Equipment"
          shortLabel="Equip"
          options={EQUIP_OPTS}
          optionLabel={equipLabel}
          selected={libEquipFilters}
          counts={libEquipCounts}
          onToggle={eq => toggleSet(setLibEquipFilters, eq)}
          open={libOpenDrop === "equip"}
          setOpen={setLibOpenDrop}
          accent={STEEL}
        />
      </div>

      {(libTypeFilters.size > 0 || libMuscleFilters.size > 0 || libEquipFilters.size > 0) && <div className={"lib-filter-chips"}>
        {[...libTypeFilters].map(v => (
          <button type="button" key={"t" + v} className={"lib-filter-chip btn-sm"} aria-label={`Remove ${TYPE_LABELS[v] || v} filter`} onClick={() => toggleSet(setLibTypeFilters, v)}>
            {TYPE_LABELS[v] || v}{" ✕"}
          </button>
        ))}
        {[...libMuscleFilters].map(v => (
          <button type="button" key={"m" + v} className={"lib-filter-chip btn-sm"} aria-label={`Remove ${muscleLabel(v)} filter`} onClick={() => toggleSet(setLibMuscleFilters, v)}>
            {muscleLabel(v)}{" ✕"}
          </button>
        ))}
        {[...libEquipFilters].map(v => (
          <button type="button" key={"e" + v} className={"lib-filter-chip btn-sm"} aria-label={`Remove ${v} filter`} onClick={() => toggleSet(setLibEquipFilters, v)}>
            {equipLabel(v)}{" ✕"}
          </button>
        ))}
      </div>}

      <div className={"lib-filtered-meta"}>
        <div className={"lib-filtered-count"}>{libFiltered.length + " exercises"}</div>
        {hasFilters && <button type="button" className={"btn btn-gold-solid btn-sm"} onClick={clearAll}>{"Clear filters"}</button>}
      </div>

      <div className={"lib-vlist-wrap"} ref={vlistWrapRef}>{libFiltered.length === 0
        ? (_exReady
            ? <div className={"empty lib-empty"} style={{ padding: "24px 0" }}>
                <div>{"No exercises match."}</div>
                <div className={"lib-empty-actions"}>
                  <button type="button" className={"btn btn-gold-solid btn-sm"} onClick={clearAll}>{"Clear filters"}</button>
                  <button type="button" className={"btn btn-ghost btn-sm"} onClick={goCreate}>{"Create exercise"}</button>
                </div>
              </div>
            : <div aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div key={"skel" + i} className={"lib-skel-row"}>
                <div className={"lib-skel-orb"} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={"lib-skel-line"} style={{ width: `${68 - i * 5}%`, marginBottom: S.s6 }} />
                  <div className={"lib-skel-line"} style={{ width: `${44 - i * 3}%`, height: 7 }} />
                </div>
              </div>)}</div>)
        : <List
            listRef={listRef}
            rowCount={libFiltered.length}
            rowHeight={LIB_ROW_H}
            rowComponent={LibExRow}
            rowProps={{
              exercises: libFiltered,
              cartSet, favSet, pbSet,
              onOpen: setLibDetailEx,
              onToggleCart: toggleCart,
              onToggleFav: toggleFav,
            }}
            overscanCount={6}
            onScroll={saveListScroll}
            style={{ height: "100%", width: "100%", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}
          />}</div>
    </div>}
  </div>;
});

export default ExerciseLibraryTab;
