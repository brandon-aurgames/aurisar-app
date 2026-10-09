/**
 * Decide whether tapping Start should resume the in-progress session,
 * ask to replace a different live workout, or begin a new one.
 */
export function liveStartAction(liveWorkout, wo) {
  if (!wo?.id) return "start";
  if (liveWorkout?.workoutId === wo.id) return "resume";
  if (liveWorkout) return "replace";
  return "start";
}
