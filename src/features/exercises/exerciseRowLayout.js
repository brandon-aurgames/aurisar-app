/**
 * Shared ExerciseRow sizes.
 *
 * The virtualized slot is the painted card plus a visible gap. Padding in
 * the slot wrapper is half the gap each side, so the card's height:100%
 * (min-height:0, border-box) fills the leftover — never a min-height that
 * can beat the slot and spill into the next row.
 *
 * The 44px checkbox/star hit areas are extra slop (`::before` on touch),
 * not extra row padding.
 */
export const EX_ROW_CARD_H = 52;
export const EX_ROW_GAP = 8;
export const EX_ROW_H = EX_ROW_CARD_H + EX_ROW_GAP;
export const EX_ROW_SLOT_PAD_Y = EX_ROW_GAP / 2;

/** Muscle-group headers in the workout picker stay a 44px target. */
export const EX_PICKER_HEADER_H = 44;
