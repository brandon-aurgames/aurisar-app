/**
 * Movement-specific hero illustrations. Only the six named patterns from
 * the product brief are authored; everything else falls back to the
 * highlighted anatomy map.
 */
export function illustrationKey(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return null;
  if (n === "bench press" || n.startsWith("bench press ")) return "bench-press";
  if (n === "box squat with bands") return "box-squat-bands";
  if (n === "barbell squat" || n === "squat") return "squat";
  if (n === "overhead press") return "overhead-press";
  if (n === "deadlift") return "deadlift";
  if (n === "pull-up" || n === "pullup" || n === "pullups" || n === "pull ups") return "pull-up";
  return null;
}
