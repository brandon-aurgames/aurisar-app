/**
 * Library-only facets derived from catalog fields that already exist.
 *
 * Goal and movement are not stored columns. They are defined here so the
 * filter chips have a documented meaning and the counts stay honest:
 *
 *   difficulty — `ex.difficulty`, else the same XP heuristic ExerciseRow uses
 *   goal       — endurance = cardio/endurance category or type tags;
 *                hypertrophy = isolation flag on a strength exercise;
 *                strength = remaining strength (and other non-endurance) work
 *   movement   — isolation flag → isolation; otherwise compound
 *
 * Flexibility / yoga / stretching rows have no Goal chip. They stay visible
 * until a goal is selected, at which point they correctly drop out rather
 * than being labelled Strength.
 */

export const DIFFICULTY_OPTS = ["Beginner", "Intermediate", "Advanced"];

export const GOAL_OPTS = ["strength", "hypertrophy", "endurance"];
export const GOAL_LABELS = {
  strength: "Strength",
  hypertrophy: "Hypertrophy",
  endurance: "Endurance",
};

export const MOVEMENT_OPTS = ["compound", "isolation"];
export const MOVEMENT_LABELS = {
  compound: "Compound",
  isolation: "Isolation",
};

export function difficultyKey(ex) {
  const raw = (ex?.difficulty || "").trim();
  if (DIFFICULTY_OPTS.includes(raw)) return raw;
  const xp = Number(ex?.baseXP) || 0;
  if (xp >= 60) return "Advanced";
  if (xp >= 45) return "Intermediate";
  return "Beginner";
}

export function goalKey(ex) {
  if (!ex) return null;
  const cat = (ex.category || "").toLowerCase().trim();
  const types = (ex.exerciseType || "").toLowerCase();
  if (
    cat === "cardio" ||
    cat === "endurance" ||
    types.includes("endurance") ||
    types.includes("cardio")
  ) {
    return "endurance";
  }
  if (cat === "flexibility" || cat === "yoga" || cat === "stretching") return null;
  if (ex.isolation) return "hypertrophy";
  return "strength";
}

export function movementKey(ex) {
  if (!ex) return "compound";
  if (ex.isolation) return "isolation";
  return "compound";
}

export const difficultyKeys = ex => [difficultyKey(ex)];
export const goalKeys = ex => {
  const g = goalKey(ex);
  return g ? [g] : [];
};
export const movementKeys = ex => [movementKey(ex)];

export function goalLabelOf(ex) {
  const g = goalKey(ex);
  return g ? GOAL_LABELS[g] : null;
}

export function movementLabelOf(ex) {
  return MOVEMENT_LABELS[movementKey(ex)];
}
