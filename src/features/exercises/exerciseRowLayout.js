/**
 * Shared ExerciseRow slot size.
 *
 * Visual chrome is a one-line name + muted meta inside this height. The
 * 44px checkbox/star hit areas are extra slop (`::before` on touch), not
 * extra row padding — so this number is the virtualized slot, not the
 * WCAG target.
 */
export const EX_ROW_H = 56;

/** Vertical padding inside a virtualized slot (top + bottom each). */
export const EX_ROW_SLOT_PAD_Y = 2;

/** Muscle-group headers in the workout picker stay a 44px target. */
export const EX_PICKER_HEADER_H = 44;
