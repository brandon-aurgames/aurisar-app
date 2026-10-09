import { formatPbValue } from '../../utils/formatPbValue';

/**
 * Format a stored exercise PB for builder rows.
 * Delegates to formatPbValue (no glyph — callers add at most one 🏆).
 */
export function formatExPb(exPB, units) {
  return formatPbValue(exPB, units);
}
