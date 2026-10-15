/**
 * Present the catalog `desc` as Setup / Movement without inventing copy.
 * First sentence (or two, when the first is very short) is Setup; the rest
 * is Movement. A single-sentence description stays under Setup.
 */
export function splitInstructions(desc) {
  const text = String(desc || "").trim();
  if (!text) return { setup: null, movement: null };
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length === 1) return { setup: parts[0], movement: null };
  const firstLen = parts[0].length;
  const setupCount = firstLen < 80 && parts.length > 2 ? 2 : 1;
  return {
    setup: parts.slice(0, setupCount).join(" "),
    movement: parts.slice(setupCount).join(" ") || null,
  };
}
