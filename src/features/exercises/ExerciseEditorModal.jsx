import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { S, R, FS } from '../../utils/tokens';
import Sheet from '../../components/ui/Sheet';
import ConfirmSheet from '../../components/ui/ConfirmSheet';
import { MUSCLE_OPTS, EQUIP_OPTS, muscleLabel, equipLabel } from './exerciseFilterOptions';
import { DIFFICULTY_OPTS } from './exEditorDraft';
import { rankSearch } from './searchRank';
import { isMetric, lbsToKg, kgToLbs, miToKm, kmToMi, weightLabel, distLabel, pctToSlider, sliderToPct } from '../../utils/units';
import { getMuscleColor, hrRange } from '../../utils/xp';
import { HR_ZONES } from '../../data/constants';
import TechSearch from './TechSearch';

const EX_ICON_LIST = ["🏋️", "💪", "⚡", "🦾", "🪃", "🏃", "🚴", "🔥", "⭕", "🧘", "🤸", "🧱", "🪝", "🏊", "🔻", "🦵", "🚶", "🧗", "🎯", "🏌️", "⛹️", "🤼", "🏇", "🥊", "🤺", "🏋", "🦶", "🫀", "🧠", "🛌", "💤", "🌙", "☕", "🧊", "🏖️"];

function ChoiceGroup({ legend, value, options, onChange, getLabel, name }) {
  return (
    <div className={"field"} role={"radiogroup"} aria-label={legend}>
      <div className={"ex-editor-legend"}>{legend}</div>
      <div style={{ display: "flex", gap: S.s4, flexWrap: "wrap" }}>
        {options.map(opt => {
          const selected = value === opt;
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              name={name}
              aria-checked={selected}
              className={`btn btn-sm ${selected ? "btn-gold" : "btn-ghost"}`}
              style={{ fontSize: FS.fs54, padding: "6px 8px", textTransform: name === "category" ? "capitalize" : undefined, flex: name === "difficulty" || name === "category" ? 1 : undefined }}
              onClick={() => onChange(opt)}
            >{getLabel ? getLabel(opt) : opt}</button>
          );
        })}
      </div>
    </div>
  );
}

function snapshotOf(draft) {
  try { return JSON.stringify(draft); } catch { return ""; }
}

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
}) {
  const [fromQ, setFromQ] = useState("");
  const [nameError, setNameError] = useState("");
  const [pending, setPending] = useState(null);
  const snapshotRef = useRef(snapshotOf(exEditorDraft));

  const fromHits = useMemo(() => {
    const q = fromQ.trim();
    if (!q) return [];
    return rankSearch(allExercises, q).slice(0, 8);
  }, [fromQ, allExercises]);

  useEffect(() => {
    snapshotRef.current = snapshotOf(exEditorDraft);
    setNameError("");
    setPending(null);
  }, [exEditorMode, exEditorDraft?.id]);

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
  const isDirty = snapshotOf(ed) !== snapshotRef.current;

  const applyStartFrom = ex => {
    openExEditor("copy", ex);
    setFromQ("");
  };

  const requestClose = () => {
    if (isDirty) setPending({ kind: "discard" });
    else setExEditorOpen(false);
  };

  const trySave = () => {
    if (!(ed.name || "").trim()) {
      setNameError("Give this exercise a name.");
      document.getElementById("ex-ed-name")?.focus();
      return;
    }
    setNameError("");
    saveExEditor();
  };

  const tipAt = (ti) => {
    const t = Array.isArray(ed.tips) ? ed.tips : ["", "", ""];
    return t[ti] || "";
  };
  const setTip = (ti, value) => {
    const t = Array.isArray(ed.tips) ? [...ed.tips] : ["", "", ""];
    while (t.length <= ti) t.push("");
    t[ti] = value;
    setEd({ tips: t });
  };

  const saveLabel = exEditorMode === "copy" ? "Save copy" : "Save exercise";

  return <>
    <Sheet
      open
      onClose={requestClose}
      layer={"editor"}
      title={title}
      titleFont={"cinzel"}
      ariaLabel={title}
      className={"ex-editor-sheet"}
      style={{ "--mg-color": getMuscleColor(ed.muscleGroup || "chest") }}
      footer={
        <div className={"ex-editor-footer"}>
          <button type="button" className={"btn btn-ghost btn-sm"} style={{ flex: 1 }} onClick={requestClose}>{"Cancel"}</button>
          <button type="button" className={"btn btn-gold-solid"} style={{ flex: 2 }} onClick={trySave}>
            {saveLabel}
          </button>
        </div>
      }
    >
      <div className={"ex-editor-body"}>
        <div className={"ex-editor-subtitle"}>{exEditorMode === "edit" ? "Edit your custom exercise" : "Create a custom exercise"}</div>
        {exEditorMode !== "edit" && <div className={"field"}>
          <label htmlFor={"ex-ed-start-from"}>{"Start from an existing exercise"}</label>
          <TechSearch
            id={"ex-ed-start-from"}
            label={"Search catalog to start from"}
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
                  if (isDirty) setPending({ kind: "startFrom", ex });
                  else applyStartFrom(ex);
                }}
              >{ex.name}</button>
            ))}
          </div>}
        </div>}

        <section className={"ex-editor-section"} aria-labelledby={"ex-ed-sec-identity"}>
          <h3 id={"ex-ed-sec-identity"} className={"ex-editor-section-title"}>{"Name & type"}</h3>
          <div style={{ display: "flex", gap: S.s8 }}>
            <div className={"field"} style={{ flex: 1 }}>
              <label htmlFor={"ex-ed-name"}>{"Exercise name"}</label>
              <input
                id={"ex-ed-name"}
                className={"inp"}
                value={ed.name || ""}
                aria-invalid={!!nameError}
                aria-describedby={nameError ? "ex-ed-name-error" : undefined}
                onChange={e => { setNameError(""); setEd({ name: e.target.value }); }}
                placeholder={"e.g. Cable Fly"}
              />
              {nameError && <div id={"ex-ed-name-error"} className={"ex-editor-error"} role={"alert"}>{nameError}</div>}
            </div>
            <div className={"field"} style={{ width: 70 }}>
              <label htmlFor={"ex-ed-icon"}>{"Icon"}</label>
              <div id={"ex-ed-icon"} className={"inp"} style={{ textAlign: "center", fontSize: "1.4rem", padding: "5px 0", cursor: "default" }}>{ed.icon || "💪"}</div>
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

          <ChoiceGroup
            legend={"Category"}
            name={"category"}
            value={ed.category}
            options={["strength", "cardio", "flexibility", "endurance"]}
            onChange={cat => setEd({ category: cat })}
          />
          <ChoiceGroup
            legend={"Muscle group"}
            name={"muscle"}
            value={ed.muscleGroup}
            options={MUSCLE_OPTS}
            getLabel={muscleLabel}
            onChange={mg => setEd({ muscleGroup: mg })}
          />
        </section>

        <section className={"ex-editor-section"} aria-labelledby={"ex-ed-sec-equip"}>
          <h3 id={"ex-ed-sec-equip"} className={"ex-editor-section-title"}>{"Equipment & difficulty"}</h3>
          <ChoiceGroup
            legend={"Equipment"}
            name={"equipment"}
            value={ed.equipment}
            options={EQUIP_OPTS}
            getLabel={equipLabel}
            onChange={eq => setEd({ equipment: eq })}
          />
          <ChoiceGroup
            legend={"Difficulty"}
            name={"difficulty"}
            value={ed.difficulty}
            options={DIFFICULTY_OPTS}
            onChange={d => setEd({ difficulty: d })}
          />
          <div className={"field"}>
            <label htmlFor={"ex-ed-xp"}>{"Base XP per session "}<span style={{ fontSize: FS.sm, color: "#8a8478", fontStyle: "italic" }}>{"— typical: 20–80"}</span></label>
            <input id={"ex-ed-xp"} className={"inp"} type={"number"} min={"1"} max={"500"} value={ed.baseXP || 40} onChange={e => setEd({ baseXP: parseInt(e.target.value) || 1 })} />
          </div>
        </section>

        <section className={"ex-editor-section"} aria-labelledby={"ex-ed-sec-defaults"}>
          <h3 id={"ex-ed-sec-defaults"} className={"ex-editor-section-title"}>{"Logging defaults"}</h3>
          <div style={{ fontSize: FS.fs63, color: "#8a8478", marginTop: S.sNeg6, fontStyle: "italic" }}>
            {"Pre-filled each time you log this exercise"}
          </div>
          <div className={"r2"}>
            <div className={"field"}>
              <label htmlFor={"ex-ed-sets"}>{"Default sets"}</label>
              <input id={"ex-ed-sets"} className={"inp"} type={"number"} min={"0"} max={"20"} value={ed.defaultSets != null ? ed.defaultSets : ""} placeholder={"0"} onChange={e => {
                const v = e.target.value;
                setEd({ defaultSets: v === "" ? null : parseInt(v) });
              }} />
            </div>
            <div className={"field"}>
              <label htmlFor={"ex-ed-reps"}>{"Default "}{isCardioED || isFlexED ? "duration (min)" : "reps"}</label>
              <input id={"ex-ed-reps"} className={"inp"} type={"number"} min={"0"} max={"300"} value={ed.defaultReps != null ? ed.defaultReps : ""} placeholder={"0"} onChange={e => {
                const v = e.target.value;
                setEd({ defaultReps: v === "" ? null : parseInt(v) });
              }} />
            </div>
          </div>
          {hasWeightED && <>
            <div className={"r2"}>
              <div className={"field"}>
                <label htmlFor={"ex-ed-weight"}>{"Default base weight ("}{wUnit}{")"}</label>
                <input id={"ex-ed-weight"} className={"inp"} type={"number"} min={"0"} max={"2000"} step={metric ? "0.5" : "2.5"} value={ed.defaultWeightLbs ? metric ? lbsToKg(ed.defaultWeightLbs) : ed.defaultWeightLbs : ""} onChange={e => {
                  const v = e.target.value;
                  const lbs = v && metric ? kgToLbs(v) : v;
                  setEd({ defaultWeightLbs: lbs || "" });
                }} placeholder={metric ? "60" : "135"} />
              </div>
              <div className={"field"}>
                <label htmlFor={"ex-ed-intensity"}>{"Default intensity %"}</label>
                <input id={"ex-ed-intensity"} className={"inp"} type={"number"} min={"50"} max={"200"} step={"5"} value={ed.defaultWeightPct || 100} onChange={e => setEd({ defaultWeightPct: parseInt(e.target.value) || 100 })} />
              </div>
            </div>
            <div>
              <label htmlFor={"ex-ed-intensity-slider"} className={"sr-only"}>{"Default intensity"}</label>
              <input
                id={"ex-ed-intensity-slider"}
                type={"range"}
                className={"pct-slider"}
                min={"0"}
                max={"100"}
                step={"5"}
                aria-valuemin={50}
                aria-valuemax={200}
                aria-valuenow={ed.defaultWeightPct || 100}
                aria-valuetext={`${ed.defaultWeightPct || 100} percent`}
                value={pctToSlider(ed.defaultWeightPct || 100)}
                onChange={e => setEd({ defaultWeightPct: sliderToPct(Number(e.target.value)) })}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: FS.fs56, color: "#8a8478", marginTop: S.s2 }}>
                <span>{"50% Deload"}</span><span>{"100% Normal"}</span><span>{"200% Max"}</span>
              </div>
            </div>
          </>}
          {isCardioED && <div className={"field"}>
            <label htmlFor={"ex-ed-distance"}>{"Default distance ("}{dUnit}{")"}</label>
            <input id={"ex-ed-distance"} className={"inp"} type={"number"} min={"0"} max={"200"} step={"0.1"} value={ed.defaultDistanceMi ? metric ? miToKm(ed.defaultDistanceMi) : ed.defaultDistanceMi : ""} onChange={e => {
              const v = e.target.value;
              const mi = v && metric ? kmToMi(v) : v;
              setEd({ defaultDistanceMi: mi || "" });
            }} placeholder={metric ? "5.0" : "3.1"} />
          </div>}
          {isCardioED && <div className={"field"}>
            <div id={"ex-ed-hr-legend"}>{"Default heart rate zone "}{profile.age ? `(Age ${profile.age})` : ""}</div>
            <div className={"hr-zone-row"} role={"radiogroup"} aria-labelledby={"ex-ed-hr-legend"}>{HR_ZONES.map(z => {
              const range = hrRange(age, z);
              const sel = (ed.defaultHrZone || null) === z.z;
              return <button type={"button"} key={z.z} role={"radio"} aria-checked={sel} className={`hr-zone-btn ${sel ? "sel" : ""}`} style={{
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
        </section>

        <section className={"ex-editor-section"} aria-labelledby={"ex-ed-sec-details"}>
          <h3 id={"ex-ed-sec-details"} className={"ex-editor-section-title"}>{"Details"}</h3>
          <div className={"field"}>
            <label htmlFor={"ex-ed-muscles"}>{"Target muscles"}</label>
            <input id={"ex-ed-muscles"} className={"inp"} value={ed.muscles || ""} onChange={e => setEd({ muscles: e.target.value })} placeholder={"e.g. Chest · Front Deltoids · Triceps"} />
          </div>
          <div className={"field"}>
            <label htmlFor={"ex-ed-desc"}>{"Description"}</label>
            <textarea id={"ex-ed-desc"} className={"inp"} rows={3} value={ed.desc || ""} onChange={e => setEd({ desc: e.target.value })} placeholder={"How to perform this exercise, key cues…"} style={{
              resize: "vertical", minHeight: 70, fontFamily: "'Inter',sans-serif", lineHeight: 1.5
            }} />
          </div>
          <div className={"field"}>
            <label htmlFor={"ex-ed-tip-0"}>{"Form tips"}</label>
            {[0, 1, 2].map(ti => (
              <input
                key={ti}
                id={`ex-ed-tip-${ti}`}
                className={"inp"}
                style={{ marginBottom: S.s6 }}
                value={tipAt(ti)}
                onChange={e => setTip(ti, e.target.value)}
                placeholder={`Tip ${ti + 1}…`}
              />
            ))}
          </div>
        </section>

        {exEditorMode === "edit" && <button type="button" className={"btn btn-ghost btn-sm"} style={{ width: "100%" }} onClick={() => openExEditor("copy", ed)}>{"Duplicate"}</button>}
        {exEditorMode === "edit" && <button type="button" className={"btn btn-danger"} style={{ width: "100%", marginTop: S.s8, padding: "10px", fontSize: FS.fs78 }} onClick={() => deleteCustomEx(ed.id)}>{"Delete exercise"}</button>}
      </div>
    </Sheet>
    <ConfirmSheet
      open={!!pending}
      title={pending?.kind === "startFrom" ? "Replace this draft?" : "Discard changes?"}
      body={pending?.kind === "startFrom"
        ? "Starting from another exercise will replace what you’ve typed."
        : "You have unsaved edits on this exercise."}
      confirmLabel={pending?.kind === "startFrom" ? "Replace" : "Discard"}
      danger={pending?.kind !== "startFrom"}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        if (pending?.kind === "startFrom") applyStartFrom(pending.ex);
        else setExEditorOpen(false);
        setPending(null);
      }}
    />
  </>;
});

export default ExerciseEditorModal;
