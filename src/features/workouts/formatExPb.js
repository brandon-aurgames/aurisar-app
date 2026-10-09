import { displayPace, displayWt, isMetric } from '../../utils/units';

/**
 * Format a stored exercise PB for builder rows.
 * Pace PBs are minutes-per-mile; displayPace divides for metric (min/km).
 */
export function formatExPb(exPB, units) {
  if (!exPB) return null;
  const metric = isMetric(units);
  const val = exPB.value ?? exPB.weight;
  if (val == null || val === "") return null;
  const type = (exPB.type || "").toLowerCase();
  if (type === "cardio" || type === "cardio pace") {
    return displayPace(val, units);
  }
  const wt = displayWt(val, units) || (metric ? String(val) + " kg" : String(val) + " lbs");
  if (type === "assisted" || type === "assisted weight") return "🏆 1RM: " + wt + " (Assisted)";
  if (type === "max reps per 1 set") return "🏆 " + val + " reps";
  if (type === "longest hold" || type === "fastest time") {
    const n = Number(val);
    return Number.isFinite(n) ? "🏆 " + parseFloat(n.toFixed(2)) + " min" : null;
  }
  if (type === "heaviest weight") return "🏆 " + wt;
  return "🏆 1RM: " + wt;
}
