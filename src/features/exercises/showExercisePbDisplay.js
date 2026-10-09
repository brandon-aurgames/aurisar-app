/**
 * Temporary kill switch for on-exercise PB badges, trophies, and
 * "1RM" notation. Tracking and storage stay intact — this only
 * stops the chrome from rendering on exercise rows, builder/plan
 * lists, quick log, and the exercise detail sheet.
 *
 * Flip to `true` to restore the previous display.
 * TODO(remove): drop this flag and the gated spans once PB chrome
 * has a less crowded home (or is deleted for good).
 */
export const SHOW_EXERCISE_PB_DISPLAY = false;
