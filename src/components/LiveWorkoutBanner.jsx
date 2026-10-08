import React, { useState } from 'react';
import { isMetric, lbsToKg, weightLabel } from '../utils/units';
import Sheet from './ui/Sheet';
import ConfirmSheet from './ui/ConfirmSheet';
import SetsEditor from './ui/SetsEditor';
import WorkoutExercisePicker from '../features/workouts/WorkoutExercisePicker';
import { isGroupStart, isGrouped } from '../features/workouts/supersetModel';

export default function LiveWorkoutBanner({
  liveWorkout,
  onToggleExercise,
  onFinish,
  onDiscard,
  onUpdateExercise,
  onRemoveExercise,
  onAddExercise,
  allExercises,
  units,
  openExEditor,
}) {
  const [open, setOpen] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerMuscle, setPickerMuscle] = useState(() => new Set());
  const [pickerTypeFilter, setPickerTypeFilter] = useState(() => new Set());
  const [pickerEquipFilter, setPickerEquipFilter] = useState(() => new Set());
  const [pickerOpenDrop, setPickerOpenDrop] = useState(null);
  const [pickerSelected, setPickerSelected] = useState([]);

  const { exercises, name, icon } = liveWorkout;
  const doneCount = exercises.filter(e => e.done).length;
  const total = exercises.length;
  const metric = isMetric(units);
  const wLabel = weightLabel(units);

  const dispW = (lbs) => lbs ? (metric ? String(lbsToKg(lbs)) : String(lbs)) : '';

  function handleFinishPress() {
    if (total - doneCount > 0) {
      setConfirmFinish(true);
    } else {
      onFinish(exercises);
      setOpen(false);
    }
  }

  function closeSheet() {
    setOpen(false);
    setConfirmFinish(false);
    setExpandedIdx(null);
    closePicker();
  }

  function closePicker() {
    setPickerOpen(false);
    setPickerSearch('');
    setPickerMuscle(new Set());
    setPickerTypeFilter(new Set());
    setPickerEquipFilter(new Set());
    setPickerOpenDrop(null);
    setPickerSelected([]);
  }

  function pickerToggleEx(exId) {
    setPickerSelected(prev => {
      const exists = prev.find(e => e.exId === exId);
      if (exists) return prev.filter(e => e.exId !== exId);
      return [...prev, {
        exId,
        sets: '3',
        reps: '10',
        weightLbs: '',
        weightPct: 100,
        durationMin: '',
        distanceMi: '',
        hrZone: null,
      }];
    });
  }

  function commitPicker() {
    if (pickerSelected.length === 0) return;
    onAddExercise(pickerSelected);
    closePicker();
  }

  function openEditor(i) {
    setExpandedIdx(prev => prev === i ? null : i);
  }

  return (
    <>
      <button className="lw-banner" onClick={() => setOpen(true)} aria-label="Open active workout tracker">
        <span className="lw-dot" />
        <span className="lw-banner-icon">{icon}</span>
        <span className="lw-name">{name}</span>
        <span className="lw-progress-badge">
          <span style={{ color: doneCount > 0 ? '#6dbb3a' : '#8a8478', fontWeight: 700 }}>{doneCount}</span>
          <span className="lw-progress-sep">{"/"}</span>
          {total}
        </span>
        <span className="lw-chevron">{"›"}</span>
      </button>

      <Sheet
        open={open}
        onClose={closeSheet}
        layer={"live"}
        navOffset={false}
        icon={icon}
        title={name}
        ariaLabel={"Active workout tracker"}
        footer={confirmFinish ? (
              <div className="lw-confirm-panel">
                <div className="lw-confirm-msg">
                  {`${total - doneCount} exercise${total - doneCount !== 1 ? 's' : ''} still unchecked — how would you like to finish?`}
                </div>
                <div className="lw-confirm-btns">
                  <button className="btn btn-gold" onClick={() => {
                    onFinish(exercises.map(e => ({ ...e, done: true })));
                    closeSheet();
                  }}>
                    {`Log All ${total} Exercises`}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => {
                    onFinish(exercises.filter(e => e.done));
                    closeSheet();
                  }}>
                    {`Log Only Checked (${doneCount})`}
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{ color: '#8a8478' }} onClick={() => setConfirmFinish(false)}>
                    {"← Keep Going"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="lw-sheet-footer">
                <button className="btn btn-ghost btn-sm" style={{ color: '#8a8478' }} onClick={() => setConfirmDiscard(true)}>
                  {"Discard"}
                </button>
                <button className="btn btn-gold" style={{ flex: 1 }} onClick={handleFinishPress}>
                  {doneCount < total
                    ? `✓ Finish (${doneCount}/${total})`
                    : '✓ Finish Workout'}
                </button>
              </div>
            )}
      >
            <div className="lw-prog-track">
              <div
                className="lw-prog-fill"
                style={{ width: total > 0 ? `${Math.round((doneCount / total) * 100)}%` : '0%' }}
              />
            </div>
            <div className="lw-prog-lbl">
              {doneCount === total && total > 0
                ? '✓ All exercises complete'
                : `${doneCount} of ${total} complete`}
            </div>

            <div className="lw-ex-list">
              {exercises.map((ex, i) => {
                const isFirstOfSuperset = isGroupStart(exercises, i);
                const isInSuperset = isGrouped(ex);
                const expanded = expandedIdx === i;
                const canEdit = ex.exId !== 'rest_day';

                return (
                  <React.Fragment key={i}>
                    {isFirstOfSuperset && (
                      <div className="lw-superset-label">{"⚡ Superset"}</div>
                    )}
                    <div className="lw-ex-item-wrap">
                      <div
                        className={`lw-ex-row${ex.done ? ' done' : ''}${isInSuperset ? ' in-superset' : ''}`}
                      >
                        <button
                          type="button"
                          className={`lw-ex-cb${ex.done ? ' done' : ''}`}
                          aria-label={ex.done ? `Mark ${ex.name} not done` : `Mark ${ex.name} done`}
                          aria-pressed={ex.done}
                          onClick={() => onToggleExercise(i)}
                        >
                          {ex.done && <span className="lw-ex-check-mark">{"✓"}</span>}
                        </button>
                        {canEdit ? (
                          <button
                            type="button"
                            className="lw-ex-info lw-ex-open"
                            aria-expanded={expanded}
                            onClick={() => openEditor(i)}
                          >
                            <div className="lw-ex-name">{ex.name}</div>
                            <div className="lw-ex-meta">
                              {ex.setsDesc || `${ex.sets}×${ex.reps}`}
                              {ex.weightLbs
                                ? ` · ${dispW(ex.weightLbs)} ${wLabel}`
                                : ''}
                            </div>
                          </button>
                        ) : (
                          <div className="lw-ex-info">
                            <div className="lw-ex-name">{ex.name}</div>
                          </div>
                        )}
                        {canEdit && (
                          <button
                            className={`lw-dots-btn${expanded ? ' active' : ''}`}
                            onClick={() => openEditor(i)}
                            aria-label={`Edit ${ex.name}`}
                          >
                            {"···"}
                          </button>
                        )}
                      </div>

                      {expanded && (
                        <div className="lw-ex-edit">
                          <SetsEditor
                            exD={{ id: ex.exId, category: ex.category, hasTreadmill: false }}
                            value={ex}
                            onField={(field, val) => onUpdateExercise(i, { [field]: val })}
                            units={units}
                            variant={"live"}
                            rowsCommitOn={"change"}
                            extraWeightMode={"lbs"}
                            showHR={false}
                            showTreadmill={false}
                            showPaceBonus={false}
                            showDist={false}
                          />

                          <div className="lw-ex-edit-actions">
                            <button className="lw-ex-edit-remove-ex" onClick={() => { onRemoveExercise(i); setExpandedIdx(null); }}>
                              {"Remove Exercise"}
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setExpandedIdx(null)}>
                              {"Done ✓"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </React.Fragment>
                );
              })}

              <div className="lw-add-ex-wrap">
                <button
                  className="lw-add-ex-btn"
                  onClick={() => { setPickerOpen(true); setExpandedIdx(null); }}
                >
                  {"+ Add Exercise"}
                </button>
              </div>
            </div>
      </Sheet>

      {pickerOpen && (
        <WorkoutExercisePicker
          pickerSearch={pickerSearch}
          setPickerSearch={setPickerSearch}
          pickerMuscle={pickerMuscle}
          setPickerMuscle={setPickerMuscle}
          pickerTypeFilter={pickerTypeFilter}
          setPickerTypeFilter={setPickerTypeFilter}
          pickerEquipFilter={pickerEquipFilter}
          setPickerEquipFilter={setPickerEquipFilter}
          pickerOpenDrop={pickerOpenDrop}
          setPickerOpenDrop={setPickerOpenDrop}
          pickerSelected={pickerSelected}
          allExercises={allExercises || []}
          closePicker={closePicker}
          openExEditor={openExEditor || (() => {})}
          pickerToggleEx={pickerToggleEx}
          commitPickerToWorkout={commitPicker}
        />
      )}

      <ConfirmSheet
        open={confirmDiscard}
        icon={"🗑"}
        title={"Discard Workout?"}
        body={`Discard "${name}"? Your progress will be lost.`}
        confirmLabel={"Discard"}
        danger
        onConfirm={() => {
          setConfirmDiscard(false);
          onDiscard();
          closeSheet();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
}
