/**
 * Comparable number for a leaderboard from any stored PB shape.
 * kind: 'weight' | 'reps' | 'pace' | 'assisted'
 * Missing or non-numeric values return null — never 0.
 */
function numericOrNull(raw) {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function pbBoardValue(pb, kind) {
  if (!pb || !kind) return null;
  const type = String(pb.type || '').toLowerCase();

  if (kind === 'weight') {
    if (type === 'assisted' || type === 'assisted weight') return null;
    if (type && type !== 'strength 1rm' && type !== 'heaviest weight' && !/\b(weight|1rm)\b/.test(type)) {
      return null;
    }
    return numericOrNull(pb.value ?? pb.weight);
  }
  if (kind === 'reps') {
    if (type && type !== 'max reps per 1 set' && !/reps/.test(type)) return null;
    return numericOrNull(pb.value ?? pb.reps);
  }
  if (kind === 'pace') {
    // Legacy {type:'cardio'} is Cardio Pace (2 of these in production).
    if (type && type !== 'cardio' && type !== 'cardio pace' && !/pace/.test(type)) return null;
    return numericOrNull(pb.value);
  }
  if (kind === 'assisted') {
    if (type && type !== 'assisted' && type !== 'assisted weight') return null;
    return numericOrNull(pb.value ?? pb.weight);
  }
  return null;
}

export function isLowerBetterPbKind(kind) {
  return kind === 'pace' || kind === 'assisted';
}

export function comparePbBoardValues(a, b, kind) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return isLowerBetterPbKind(kind) ? a - b : b - a;
}
