/** Serializable snapshot of workout-builder fields for unsaved-change detection. */
export function serializeBuilderDraft({
  name,
  icon,
  desc,
  intensity,
  exercises,
  duration,
  durationSec,
  activeCal,
  totalCal,
  labels,
}) {
  return JSON.stringify({
    name: name ?? "",
    icon: icon ?? "",
    desc: desc ?? "",
    intensity: intensity ?? "",
    exercises: exercises ?? [],
    duration: duration ?? "",
    durationSec: durationSec ?? "",
    activeCal: activeCal ?? "",
    totalCal: totalCal ?? "",
    labels: labels ?? [],
  });
}

export function builderDraftIsDirty(baseline, current) {
  if (baseline == null) return false;
  return serializeBuilderDraft(current) !== baseline;
}
