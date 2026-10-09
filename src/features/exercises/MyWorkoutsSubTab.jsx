import React, { memo, useMemo, useRef, useState } from 'react';
import { S } from '../../utils/tokens';
import ExerciseRow from './ExerciseRow';
import TechSearch from './TechSearch';
import { matchesSearchExpanded } from './searchRank';
import { recentExerciseIds, RECENT_COUNT } from './recentExercises';
import { SHOW_EXERCISE_PB_DISPLAY } from './showExercisePbDisplay';

const FAV_PAGE = 20;

function AccordionSection({ id, title, meta, isOpen, onToggle, headerRef, children }) {
  return (
    <div className={"myex-accordion"}>
      <button
        type="button"
        ref={headerRef}
        className={"myex-accordion-hdr"}
        aria-expanded={isOpen}
        onClick={() => onToggle(id)}
      >
        <span className={"myex-accordion-hdr-title"}>{title}</span>
        {meta && <span className={"myex-accordion-hdr-meta"}>{meta}</span>}
        <span aria-hidden="true" className={`myex-accordion-chevron${isOpen ? " open" : ""}`}>{"⌄"}</span>
      </button>
      <div className={`myex-accordion-track${isOpen ? " open" : ""}`}>
        <div className={"myex-accordion-body"} inert={!isOpen}>
          <div className={"myex-accordion-inner"}>{children}</div>
        </div>
      </div>
    </div>
  );
}

const MyWorkoutsSubTab = memo(function MyWorkoutsSubTab({
  profile,
  setProfile,
  allExById,
  isInCart,
  toggleCart,
  setLibDetailEx,
  openExEditor,
  deleteCustomEx,
}) {
  const [favVisibleCount, setFavVisibleCount] = useState(FAV_PAGE);
  const [openSection, setOpenSection] = useState("favorites");
  const [recentNow] = useState(() => Date.now());
  const [mySearch, setMySearch] = useState("");

  const favHeaderRef = useRef(null);
  const customHeaderRef = useRef(null);
  const recentHeaderRef = useRef(null);
  const headerRefs = { favorites: favHeaderRef, custom: customHeaderRef, recent: recentHeaderRef };

  const toggleSection = id => {
    setOpenSection(prev => {
      const next = prev === id ? null : id;
      if (prev && prev !== next && document.activeElement) {
        const prevRef = headerRefs[prev];
        const prevBody = prevRef?.current?.closest(".myex-accordion")?.querySelector(".myex-accordion-body");
        if (prevBody?.contains(document.activeElement)) prevRef.current?.focus();
      }
      return next;
    });
  };

  const recentExercises = useMemo(
    () => recentExerciseIds(profile.log, allExById, recentNow, RECENT_COUNT),
    [profile.log, allExById, recentNow]
  );

  const favCount = (profile.favoriteExercises || []).length;
  const customCount = (profile.customExercises || []).length;

  const toggleFav = id => setProfile(p => ({
    ...p,
    favoriteExercises: (p.favoriteExercises || []).includes(id)
      ? (p.favoriteExercises || []).filter(i => i !== id)
      : [...(p.favoriteExercises || []), id]
  }));

  const pbOn = id => SHOW_EXERCISE_PB_DISPLAY && !!(profile.exercisePBs || {})[id];
  const q = mySearch.trim();
  const matchEx = ex => !q || matchesSearchExpanded(ex, q);

  return (
    <div>
      <div style={{ marginBottom: S.s10 }}>
        <TechSearch
          value={mySearch}
          onChange={setMySearch}
          onClear={() => setMySearch("")}
          placeholder={"Search my exercises…"}
        />
      </div>
      <AccordionSection
        id="favorites"
        title="Favorites"
        meta={favCount || null}
        isOpen={openSection === "favorites"}
        onToggle={toggleSection}
        headerRef={favHeaderRef}
      >
        {favCount === 0 ? (
          <div className={"empty"} style={{ padding: "16px 0" }}>
            {"No favorites yet — tap the star on any exercise."}
          </div>
        ) : (
          <div className={"lib-home-rows"}>
            {(profile.favoriteExercises || []).filter(id => allExById[id] && matchEx(allExById[id])).slice(0, favVisibleCount).map(exId => {
              const ex = allExById[exId];
              if (!ex) return null;
              return (
                <ExerciseRow
                  key={exId}
                  ex={ex}
                  selected={isInCart(exId)}
                  showEquipment
                  showPB={pbOn(ex.id)}
                  isFav
                  onToggleFav={() => toggleFav(ex.id)}
                  onToggleSelect={toggleCart}
                  onActivate={() => setLibDetailEx(ex)}
                />
              );
            })}
            {favCount > favVisibleCount && (
              <button
                type="button"
                className={"btn btn-ghost btn-sm"}
                onClick={() => setFavVisibleCount(c => c + FAV_PAGE)}
                style={{ width: "100%", marginTop: S.s2 }}
              >{`Show more (${favVisibleCount} of ${favCount})`}</button>
            )}
          </div>
        )}
      </AccordionSection>

      <AccordionSection
        id="custom"
        title="Custom"
        meta={customCount || null}
        isOpen={openSection === "custom"}
        onToggle={toggleSection}
        headerRef={customHeaderRef}
      >
        {customCount === 0 ? (
          <div className={"empty"} style={{ padding: "12px 0" }}>{"No custom exercises yet."}</div>
        ) : (
          <div className={"lib-home-rows"}>
            {(profile.customExercises || []).filter(matchEx).map(ex => {
              const isFav = (profile.favoriteExercises || []).includes(ex.id);
              return (
                <ExerciseRow
                  key={ex.id}
                  ex={ex}
                  selected={isInCart(ex.id)}
                  showEquipment
                  showCustomBadge
                  showPB={pbOn(ex.id)}
                  isFav={isFav}
                  onToggleFav={() => toggleFav(ex.id)}
                  onToggleSelect={toggleCart}
                  onActivate={() => setLibDetailEx(ex)}
                  trailing={
                    <div className={"ex-row-tools"}>
                      <button
                        type="button"
                        className={"ex-row-icon-btn btn-sm"}
                        onClick={e => { e.stopPropagation(); openExEditor("edit", ex); }}
                        aria-label={`Edit ${ex.name}`}
                      >{"Edit"}</button>
                      <button
                        type="button"
                        className={"ex-row-icon-btn ex-row-icon-btn--danger btn-sm"}
                        onClick={e => { e.stopPropagation(); deleteCustomEx(ex.id); }}
                        aria-label={`Delete ${ex.name}`}
                      >{"Delete"}</button>
                    </div>
                  }
                />
              );
            })}
          </div>
        )}
        <button
          type="button"
          className={"btn btn-ghost btn-sm"}
          onClick={() => openExEditor("create", null)}
          style={{ marginTop: S.s10, width: "100%" }}
        >{"Create exercise"}</button>
      </AccordionSection>

      <AccordionSection
        id="recent"
        title="Recent"
        meta={recentExercises.length ? recentExercises[0].ex.name : null}
        isOpen={openSection === "recent"}
        onToggle={toggleSection}
        headerRef={recentHeaderRef}
      >
        {recentExercises.length === 0 ? (
          <div className={"empty"} style={{ padding: "16px 0" }}>
            {"Nothing logged yet — your last 5 exercises will show up here."}
          </div>
        ) : (
          <div className={"lib-home-rows"}>
            {recentExercises.filter(({ ex }) => matchEx(ex)).map(({ ex }) => (
              <ExerciseRow
                key={ex.id}
                ex={ex}
                selected={isInCart(ex.id)}
                showEquipment
                showPB={pbOn(ex.id)}
                isFav={(profile.favoriteExercises || []).includes(ex.id)}
                onToggleFav={() => toggleFav(ex.id)}
                onToggleSelect={toggleCart}
                onActivate={() => setLibDetailEx(ex)}
              />
            ))}
          </div>
        )}
      </AccordionSection>
    </div>
  );
});

export default MyWorkoutsSubTab;
