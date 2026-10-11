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

/**
 * Supported defaults the editor has no control for but detail actions read
 * (detailWorkoutEntry uses defaultDurationMin). A copy must carry them.
 */
export const COPY_EXTRA_FIELDS = ["defaultDurationMin"];

function copyPbFields(from, to) {
  if (!from) return to;
  for (const key of [...PB_FIELDS, ...COPY_EXTRA_FIELDS]) {
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

/** Inclusive numeric bounds, in stored units (lbs / miles). "" and null mean unset. */
export const NUMERIC_RULES = {
  baseXP: { label: "Base XP", min: 1, max: 500 },
  defaultSets: { label: "Default sets", min: 0, max: 20 },
  defaultReps: { label: "Default reps / duration", min: 0, max: 300 },
  defaultWeightLbs: { label: "Default weight", min: 0, max: 4410 },
  defaultWeightPct: { label: "Default intensity", min: 50, max: 200 },
  defaultDistanceMi: { label: "Default distance", min: 0, max: 200 },
};

/** Returns `{ field: message }` for every out-of-range or non-finite value. */
export function validateExerciseDraft(draft) {
  const errors = {};
  if (!draft) return errors;
  for (const [key, rule] of Object.entries(NUMERIC_RULES)) {
    const raw = draft[key];
    if (raw === "" || raw === null || raw === undefined) {
      if (rule.required) errors[key] = `${rule.label} is required.`;
      continue;
    }
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) errors[key] = `${rule.label} must be a number.`;
    else if (n < rule.min || n > rule.max) errors[key] = `${rule.label} must be between ${rule.min} and ${rule.max}.`;
  }
  return errors;
}

/**
 * Draft for the custom-exercise editor.
 *
 * Edit keeps the existing object (id + every unmodeled/legacy field, full
 * tips array). Copy and create mint a new id. Copy also carries PB type
 * fields and defaultDurationMin so a duplicate of Bench Press still tracks PBs.
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
  const invalid = validateExerciseDraft(draft);
  const firstInvalid = Object.values(invalid)[0];
  if (firstInvalid) return { error: firstInvalid, fieldErrors: invalid };
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
