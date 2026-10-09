import { uid } from '../../utils/helpers';

export const DIFFICULTY_OPTS = ["Beginner", "Intermediate", "Advanced"];

/** Fields the editor UI actually writes. Everything else stays on the stored row. */
export const EDITABLE_FIELDS = [
  "name",
  "icon",
  "category",
  "muscleGroup",
  "equipment",
  "difficulty",
  "baseXP",
  "muscles",
  "desc",
  "tips",
  "defaultSets",
  "defaultReps",
  "defaultWeightLbs",
  "defaultWeightPct",
  "defaultHrZone",
  "defaultDistanceMi",
];

/**
 * PB tracking fields. Friend-shared customs and built-ins carry these;
 * dropping them on edit/copy makes the next log rebuild wipe that PB.
 */
export const PB_FIELDS = ["pbType", "pbTier", "primaryPBMetric", "markAsPB"];

function copyPbFields(from, to) {
  if (!from) return to;
  for (const key of PB_FIELDS) {
    if (from[key] !== undefined) to[key] = from[key];
  }
  return to;
}

function modeledFields(base, { name, id }) {
  const tips = base && Array.isArray(base.tips) ? [...base.tips] : ["", "", ""];
  return {
    id,
    name,
    icon: base ? base.icon : "💪",
    category: base ? base.category : "strength",
    muscleGroup: base ? base.muscleGroup : "chest",
    equipment: base ? (base.equipment || "bodyweight") : "bodyweight",
    difficulty: base ? (base.difficulty || "") : "",
    baseXP: base ? base.baseXP : 40,
    muscles: base ? (base.muscles || "") : "",
    desc: base ? (base.desc || "") : "",
    tips,
    custom: true,
    defaultSets: base ? (base.defaultSets != null ? base.defaultSets : null) : 3,
    defaultReps: base ? (base.defaultReps != null ? base.defaultReps : null) : 10,
    defaultWeightLbs: base ? (base.defaultWeightLbs || "") : "",
    defaultWeightPct: base ? (base.defaultWeightPct || 100) : 100,
    defaultHrZone: base ? (base.defaultHrZone || null) : null,
    defaultDistanceMi: base ? (base.defaultDistanceMi || "") : "",
  };
}

/**
 * Draft for the custom-exercise editor.
 *
 * Edit keeps the existing object (id + every unmodeled/legacy field, full
 * tips array). Copy and create mint a new id. Copy also carries PB type
 * fields so a duplicate of Bench Press still tracks PBs.
 */
export function newExDraft(base, mode = "create") {
  const isEdit = mode === "edit" && !!base;
  if (isEdit) {
    const tips = Array.isArray(base.tips) ? [...base.tips] : ["", "", ""];
    return { ...base, tips, custom: true };
  }
  const draft = modeledFields(base, {
    id: uid(),
    name: base ? `${base.name} (Copy)` : "",
  });
  return copyPbFields(base, draft);
}

/**
 * Merge the editor's writable fields into the stored custom exercise.
 * Id, pbType and any other unmodeled keys stay on the stored row.
 */
export function mergeEditedExercise(stored, draft) {
  const next = { ...stored };
  for (const key of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(draft, key)) {
      next[key] = draft[key];
    }
  }
  next.id = stored.id;
  next.custom = true;
  return next;
}

/**
 * Apply a create / copy / edit save against the custom-exercise list.
 * Returns `{ list, item, toast }` or `{ error }`.
 */
export function saveCustomExercise({ mode, draft, list }) {
  const name = (draft?.name || "").trim();
  if (!name) return { error: "Exercise needs a name!" };
  const cleaned = { ...draft, name };
  const current = Array.isArray(list) ? list : [];

  if (mode === "edit") {
    const stored = current.find(e => e.id === cleaned.id);
    if (!stored) return { error: "Exercise not found." };
    const item = mergeEditedExercise(stored, cleaned);
    return {
      item,
      list: current.map(e => e.id === stored.id ? item : e),
      toast: "Exercise saved.",
    };
  }

  const item = copyPbFields(cleaned, {
    ...cleaned,
    id: cleaned.id || uid(),
    custom: true,
  });
  return {
    item,
    list: [...current, item],
    toast: mode === "copy" ? "Copy created." : "Exercise created.",
  };
}
