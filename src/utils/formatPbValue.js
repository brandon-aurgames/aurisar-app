import { displayPace, displayWt } from './units';

/**
 * Format a stored exercise PB as a value string: no glyph, no "1RM" label.
 * Handles every type calcExercisePBs emits plus legacy {weight},
 * {type:'cardio'}, and {type:'assisted'}. Pace is stored as min/mi and
 * converted to min/km by dividing (displayPace), never multiplying.
 */
export function formatPbValue(pb, units) {
  if (!pb) return null;
  const type = String(pb.type || '').toLowerCase();
  const val = pb.value ?? pb.weight;
  if (val == null || val === '') return null;

  if (type === 'cardio' || type === 'cardio pace') {
    return displayPace(val, units);
  }
  if (type === 'assisted' || type === 'assisted weight') {
    const wt = displayWt(val, units);
    return wt ? wt + ' (Assisted)' : null;
  }
  if (type === 'max reps per 1 set') {
    return String(val) + ' reps';
  }
  if (type === 'longest hold' || type === 'fastest time') {
    const n = Number(val);
    return Number.isFinite(n) ? String(parseFloat(n.toFixed(2))) + ' min' : null;
  }
  if (type === 'heaviest weight' || type === 'strength 1rm' || /weight|1rm/.test(type)) {
    return displayWt(val, units) || String(val);
  }
  if (/reps/.test(type)) return String(val) + ' reps';
  if (/pace/.test(type)) return displayPace(val, units);
  if (pb.weight != null && pb.value == null) {
    return displayWt(pb.weight, units) || String(pb.weight);
  }
  return displayWt(val, units) || String(val);
}
