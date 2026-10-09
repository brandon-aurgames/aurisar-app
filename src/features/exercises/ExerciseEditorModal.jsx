import React, { memo, useMemo, useState } from 'react';
import { S, R, FS } from '../../utils/tokens';
import Sheet from '../../components/ui/Sheet';
import { MUSCLE_OPTS, EQUIP_OPTS, muscleLabel, equipLabel } from './exerciseFilterOptions';
import { DIFFICULTY_OPTS, newExDraft as buildDraft } from './exEditorDraft';
import { rankSearch } from './searchRank';
import { isMetric, lbsToKg, kgToLbs, miToKm, kmToMi, weightLabel, distLabel, pctToSlider, sliderToPct } from '../../utils/units';
import { getMuscleColor, hrRange } from '../../utils/xp';
import { HR_ZONES } from '../../data/constants';
import TechSearch from './TechSearch';

const EX_ICON_LIST = ["🏋️", "💪", "⚡", "🦾", "🪃", "🏃", "🚴", "🔥", "⭕", "🧘", "🤸", "🧱", "🪝", "🏊", "🔻", "🦵", "🚶", "🧗", "🎯", "🏌️", "⛹️", "🤼", "🏇", "🥊", "🤺", "🏋", "🦶", "🫀", "🧠", "🛌", "💤", "🌙", "☕", "🧊", "🏖️"];

const ExerciseEditorModal = memo(function ExerciseEditorModal({
  exEditorDraft,
  setExEditorDraft,
  setExEditorOpen,
  exEditorMode,
  allExercises,
  profile,
  saveExEditor,
  openExEditor,
  deleteCustomEx,
  newExDraft,
}) {
  const [fromQ, setFromQ] = useState("");
  const fromHits = useMemo(() => {
    const q = fromQ.trim();
    if (!q) return [];
    return rankSearch(allExercises, q).slice(0, 8);
  }, [fromQ, allExercises]);
  if (!exEditorDraft) return null;
  const ed = exEditorDraft;
  const setEd = patch => setExEditorDraft(d => ({ ...d, ...patch }));
  const isCardioED = ed.category === "cardio";
  const isFlexED = ed.category === "flexibility";
  const hasWeightED = !isCardioED && !isFlexED;
  const metric = isMetric(profile.units);
  const wUnit = weightLabel(profile.units);
  const dUnit = distLabel(profile.units);
  const age = profile.age || 30;
  const title = exEditorMode === "edit" ? "Edit exercise" : exEditorMode === "copy" ? "Duplicate exercise" : "New custom exercise";
  const makeDraft = newExDraft || buildDraft;

  return <Sheet
    open
    onClose={() => setExEditorOpen(false)}
    layer={"editor"}
    title={title}
    titleFont={"cinzel"}
    ariaLabel={title}
    className={"ex-editor-sheet"}
    style={{ "--mg-color": getMuscleColor(ed.muscleGroup || "chest") }}
    footer={
      <div className={"ex-editor-footer"}>
        <button type="button" className={"btn btn-ghost btn-sm"} style={{ flex: 1 }} onClick={() => setExEditorOpen(false)}>{"Cancel"}</button>
        <button type="button" className={"btn btn-gold-solid"} style={{ flex: 2 }} onClick={saveExEditor}>
          {exEditorMode === "edit" ? "Save exercise" : "Save exercise"}
        </button>
      </div>
    }
  >
    <div className={"ex-editor-body"}>
      <div className={"ex-editor-subtitle"}>{exEditorMode === "edit" ? "Edit your custom exercise" : "Create a custom exercise"}</div>
      {exEditorMode !== "edit" && <div className={"field"}>
        <label>{"Start from an existing exercise"}</label>
        <TechSearch
          value={fromQ}
          onChange={setFromQ}
          onClear={() => setFromQ("")}
          placeholder={"Search the catalog…"}
        />
        {fromHits.length > 0 && <div className={"ex-editor-from-list"}>
          {fromHits.map(ex => (
            <button
              type="button"
              key={ex.id}
              className={"ex-editor-from-hit"}
              onClick={() => {
                setExEditorDraft(makeDraft(ex, "copy"));
                setFromQ("");
              }}
            >{ex.name}</button>
          ))}
        </div>}
      </div>}

      <div style={{ display: "flex", gap: S.s8 }}>
        <div className={"field"} style={{ flex: 1 }}>
          <label>{"Exercise name"}</label>
          <input className={"inp"} value={ed.name || ""} onChange={e => setEd({ name: e.target.value })} placeholder={"e.g. Cable Fly"} />
        </div>
        <div className={"field"} style={{ width: 70 }}>
          <label>{"Icon"}</label>
          <div className={"inp"} style={{ textAlign: "center", fontSize: "1.4rem", padding: "5px 0", cursor: "default" }}>{ed.icon || "💪"}</div>
        </div>
      </div>

      <div role={"group"} aria-label={"Choose an icon"} style={{ display: "flex", flexWrap: "wrap", gap: S.s4, marginBottom: S.s4 }}>
        {EX_ICON_LIST.map(ic => (
          <button
            type={"button"}
            key={ic}
            aria-label={`Icon ${ic}`}
            aria-pressed={ed.icon === ic}
            onClick={() => setEd({ icon: ic })}
            style={{
              width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "1.15rem", cursor: "pointer", borderRadius: R.r7, padding: 0,
              border: `1px solid ${ed.icon === ic ? "rgba(180,172,158,.2)" : "rgba(45,42,36,.22)"}`,
              background: ed.icon === ic ? "rgba(45,42,36,.25)" : "rgba(45,42,36,.12)",
            }}
          >{ic}</button>
        ))}
      </div>

      <div className={"field"}>
        <label>{"Category"}</label>
        <div style={{ display: "flex", gap: S.s6 }}>
          {["strength", "cardio", "flexibility", "endurance"].map(cat => (
            <button
              key={cat}
              type="button"
              className={`btn btn-sm ${ed.category === cat ? "btn-gold" : "btn-ghost"}`}
              style={{ flex: 1, textTransform: "capitalize", fontSize: FS.fs58, padding: "6px 2px" }}
              onClick={() => setEd({ category: cat })}
            >{cat}</button>
          ))}
        </div>
      </div>

      <div className={"field"}>
        <label>{"Muscle group"}</label>
        <div style={{ display: "flex", gap: S.s4, flexWrap: "wrap" }}>
          {MUSCLE_OPTS.map(mg => (
            <button
              key={mg}
              type="button"
              className={`btn btn-sm ${ed.muscleGroup === mg ? "btn-gold" : "btn-ghost"}`}
              style={{ fontSize: FS.fs54, padding: "4px 8px" }}
              onClick={() => setEd({ muscleGroup: mg })}
            >{muscleLabel(mg)}</button>
          ))}
        </div>
      </div>

      <div className={"field"}>
        <label>{"Equipment"}</label>
        <div style={{ display: "flex", gap: S.s4, flexWrap: "wrap" }}>
          {EQUIP_OPTS.map(eq => (
            <button
              key={eq}
              type="button"
              className={`btn btn-sm ${ed.equipment === eq ? "btn-gold" : "btn-ghost"}`}
              style={{ fontSize: FS.fs54, padding: "4px 8px" }}
              onClick={() => setEd({ equipment: eq })}
            >{equipLabel(eq)}</button>
          ))}
        </div>
      </div>

      <div className={"field"}>
        <label>{"Difficulty"}</label>
        <div style={{ display: "flex", gap: S.s6 }}>
          {DIFFICULTY_OPTS.map(d => (
            <button
              key={d}
              type="button"
              className={`btn btn-sm ${ed.difficulty === d ? "btn-gold" : "btn-ghost"}`}
              style={{ flex: 1, fontSize: FS.fs58, padding: "6px 2px" }}
              onClick={() => setEd({ difficulty: d })}
            >{d}</button>
          ))}
        </div>
      </div>

      <div className={"field"}>
        <label>{"Base XP per session "}<span style={{ fontSize: FS.sm, color: "#8a8478", fontStyle: "italic" }}>{"— typical: 20–80"}</span></label>
        <input className={"inp"} type={"number"} min={"1"} max={"500"} value={ed.baseXP || 40} onChange={e => setEd({ baseXP: parseInt(e.target.value) || 1 })} />
      </div>

      <div className={"ex-editor-section"}>
        <div className={"ex-editor-section-title"}>{"Default values when logging"}</div>
        <div style={{ fontSize: FS.fs63, color: "#8a8478", marginTop: S.sNeg6, fontStyle: "italic" }}>
          {"Pre-filled each time you log this exercise"}
        </div>
        <div className={"r2"}>
          <div className={"field"}>
            <label>{"Default sets"}</label>
            <input className={"inp"} type={"number"} min={"0"} max={"20"} value={ed.defaultSets != null ? ed.defaultSets : ""} placeholder={"0"} onChange={e => {
              const v = e.target.value;
              setEd({ defaultSets: v === "" ? null : parseInt(v) });
            }} />
          </div>
          <div className={"field"}>
            <label>{"Default "}{isCardioED || isFlexED ? "duration (min)" : "reps"}</label>
            <input className={"inp"} type={"number"} min={"0"} max={"300"} value={ed.defaultReps != null ? ed.defaultReps : ""} placeholder={"0"} onChange={e => {
              const v = e.target.value;
              setEd({ defaultReps: v === "" ? null : parseInt(v) });
            }} />
          </div>
        </div>
        {hasWeightED && <>
          <div className={"r2"}>
            <div className={"field"}>
              <label>{"Default base weight ("}{wUnit}{")"}</label>
              <input className={"inp"} type={"number"} min={"0"} max={"2000"} step={metric ? "0.5" : "2.5"} value={ed.defaultWeightLbs ? metric ? lbsToKg(ed.defaultWeightLbs) : ed.defaultWeightLbs : ""} onChange={e => {
                const v = e.target.value;
                const lbs = v && metric ? kgToLbs(v) : v;
                setEd({ defaultWeightLbs: lbs || "" });
              }} placeholder={metric ? "60" : "135"} />
            </div>
            <div className={"field"}>
              <label>{"Default intensity %"}</label>
              <input className={"inp"} type={"number"} min={"50"} max={"200"} step={"5"} value={ed.defaultWeightPct || 100} onChange={e => setEd({ defaultWeightPct: parseInt(e.target.value) || 100 })} />
            </div>
          </div>
          <div>
            <input type={"range"} className={"pct-slider"} min={"0"} max={"100"} step={"5"} value={pctToSlider(ed.defaultWeightPct || 100)} onChange={e => setEd({ defaultWeightPct: sliderToPct(Number(e.target.value)) })} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: FS.fs56, color: "#8a8478", marginTop: S.s2 }}>
              <span>{"50% Deload"}</span><span>{"100% Normal"}</span><span>{"200% Max"}</span>
            </div>
          </div>
        </>}
        {isCardioED && <div className={"field"}>
          <label>{"Default distance ("}{dUnit}{")"}</label>
          <input className={"inp"} type={"number"} min={"0"} max={"200"} step={"0.1"} value={ed.defaultDistanceMi ? metric ? miToKm(ed.defaultDistanceMi) : ed.defaultDistanceMi : ""} onChange={e => {
            const v = e.target.value;
            const mi = v && metric ? kmToMi(v) : v;
            setEd({ defaultDistanceMi: mi || "" });
          }} placeholder={metric ? "5.0" : "3.1"} />
        </div>}
        {isCardioED && <div className={"field"}>
          <label>{"Default heart rate zone "}{profile.age ? `(Age ${profile.age})` : ""}</label>
          <div className={"hr-zone-row"}>{HR_ZONES.map(z => {
            const range = hrRange(age, z);
            const sel = (ed.defaultHrZone || null) === z.z;
            return <button type={"button"} key={z.z} aria-pressed={sel} className={`hr-zone-btn ${sel ? "sel" : ""}`} style={{
              "--zc": z.color,
              borderColor: sel ? z.color : "rgba(45,42,36,.2)",
              background: sel ? `${z.color}22` : "rgba(45,42,36,.12)"
            }} onClick={() => setEd({ defaultHrZone: sel ? null : z.z })}>
              <span className={"hz-name"} style={{ color: sel ? z.color : "#8a8478" }}>{"Z"}{z.z}{" "}{z.name}</span>
              <span className={"hz-bpm"} style={{ color: sel ? z.color : "#8a8478" }}>{range.lo}{"–"}{range.hi}</span>
            </button>;
          })}</div>
          {!profile.age && <div style={{ fontSize: FS.sm, color: "#8a8478", marginTop: S.s4 }}>{"Set your age in Profile for accurate BPM ranges"}</div>}
        </div>}
      </div>

      <div className={"ex-editor-section-title"} style={{ marginTop: S.s4 }}>{"Exercise details (optional)"}</div>
      <div className={"field"}>
        <label>{"Target muscles"}</label>
        <input className={"inp"} value={ed.muscles || ""} onChange={e => setEd({ muscles: e.target.value })} placeholder={"e.g. Chest · Front Deltoids · Triceps"} />
      </div>
      <div className={"field"}>
        <label>{"Description"}</label>
        <textarea className={"inp"} rows={3} value={ed.desc || ""} onChange={e => setEd({ desc: e.target.value })} placeholder={"How to perform this exercise, key cues…"} style={{
          resize: "vertical", minHeight: 70, fontFamily: "'Inter',sans-serif", lineHeight: 1.5
        }} />
      </div>
      <div className={"field"}>
        <label>{"Form tips (up to 3)"}</label>
        {[0, 1, 2].map(ti => (
          <input
            key={ti}
            className={"inp"}
            style={{ marginBottom: S.s6 }}
            value={(ed.tips || ["", "", ""])[ti] || ""}
            onChange={e => {
              const t = [...(ed.tips || ["", "", ""])];
              t[ti] = e.target.value;
              setEd({ tips: t });
            }}
            placeholder={`Tip ${ti + 1}…`}
          />
        ))}
      </div>

      {exEditorMode === "edit" && <button type="button" className={"btn btn-ghost btn-sm"} style={{ width: "100%" }} onClick={() => openExEditor("copy", ed)}>{"Duplicate"}</button>}
      {exEditorMode === "edit" && <button type="button" className={"btn btn-danger"} style={{ width: "100%", marginTop: S.s8, padding: "10px", fontSize: FS.fs78 }} onClick={() => deleteCustomEx(ed.id)}>{"Delete exercise"}</button>}
    </div>
  </Sheet>;
});

export default ExerciseEditorModal;
