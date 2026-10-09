import { uid } from '../../utils/helpers';

export const DIFFICULTY_OPTS = ["Beginner", "Intermediate", "Advanced"];

/**
 * Draft for the custom-exercise editor.
 *
 * Edit keeps the existing id and name so save can find the row. Copy and
 * create mint a new id; copy appends " (Copy)" so the duplicate is obvious.
 */
export function newExDraft(base, mode = "create") {
  const isEdit = mode === "edit" && !!base;
  const tips = base && Array.isArray(base.tips)
    ? [...base.tips, "", "", ""].slice(0, 3)
    : ["", "", ""];
  return {
    id: isEdit ? base.id : uid(),
    name: isEdit ? (base.name || "") : (base ? `${base.name} (Copy)` : ""),
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
