/**
 * simClock — the fixed-step accumulator, extracted so it can be tested.
 *
 * PURE. Owns no clock of its own: the caller passes `nowMs`, which is what makes
 * a 4-hour tab stall or a backwards clock jump an ordinary unit test instead of
 * a thing you wait around to reproduce.
 *
 * ─── Why this is a module and not four lines in the render loop ──────────────
 * It was four lines in the render loop (view/dev/spike.js), which was correct
 * for a spike and wrong the moment anything else needed the same clock. Remote
 * interpolation needs the residual phase to blend between sim steps; so will the
 * camera, and so will P9's animation clocks. Four lines copied three times is
 * three places for the spiral guard to be forgotten.
 *
 * ─── The spiral of death, and why the guard is a clamp and not a counter ─────
 * A background tab returning after two minutes owes ~7,200 steps. Running them
 * costs more than a frame, which grows the next delta, which owes more steps.
 * The clamp caps how much time a single frame may owe; the simulation simply
 * loses the stall, which is the correct trade for a client (the server is
 * authoritative about where anyone actually is). Counting steps and bailing
 * mid-loop would instead leave the accumulator full and spiral on the next frame.
 */

/** 60 Hz. The rate the walker and every rule that takes a dt were tuned at. */
export const SIM_STEP_MS = 1000 / 60;

/**
 * Time a single advance may owe. 250 ms is ~15 steps: enough to ride out a
 * garbage-collection pause or a slow frame without visibly dropping simulation,
 * far short of the thousands a real stall would produce.
 */
export const MAX_CATCH_UP_MS = 250;

export function createSimClock({
  stepMs = SIM_STEP_MS,
  maxCatchUpMs = MAX_CATCH_UP_MS,
} = {}) {
  if (!(stepMs > 0)) throw new Error('[simClock] stepMs must be positive');

  let accumulator = 0;
  let lastMs = null;
  let tick = 0;

  return {
    /**
     * Fold elapsed time in and report how many fixed steps are owed. The caller
     * runs that many steps; nothing here runs them, so this stays pure and the
     * step body stays wherever it belongs.
     *
     * @returns {number} steps to run this frame
     */
    advance(nowMs) {
      if (!Number.isFinite(nowMs)) return 0;

      // First call establishes the origin rather than owing everything since
      // the epoch — otherwise frame one runs the spiral guard's entire budget.
      if (lastMs === null) {
        lastMs = nowMs;
        return 0;
      }

      // A backwards clock (manual system-time change, or a caller mixing two
      // time sources) would otherwise drive the accumulator negative and stall
      // the simulation until real time caught back up.
      const delta = Math.max(0, nowMs - lastMs);
      lastMs = nowMs;

      accumulator = Math.min(accumulator + delta, maxCatchUpMs);

      // Subtract one step at a time rather than `floor(accumulator / stepMs)`
      // then `-= steps * stepMs`. The step is 16.666…, so the divide-and-
      // multiply form leaves a float residue that compounds: measured, it made
      // consecutive identical frames yield 1 step then 2, because the residue
      // drifted the accumulator across the boundary. Repeated subtraction is
      // self-correcting — and it cannot run away, because the clamp above
      // already bounds the accumulator at maxCatchUpMs (15 iterations at 60 Hz).
      let steps = 0;
      while (accumulator >= stepMs) {
        accumulator -= stepMs;
        steps += 1;
      }
      tick += steps;
      return steps;
    },

    /**
     * Residual phase in [0, 1) — how far the render sits between the last
     * completed step and the next one. This is the blend factor for smoothing
     * anything driven by the fixed step at a higher display rate.
     */
    alpha: () => accumulator / stepMs,

    /** Monotonic count of completed steps since construction. */
    tick: () => tick,

    /** Fixed-step duration, so consumers never re-derive (or re-guess) it. */
    stepMs: () => stepMs,

    /**
     * Forget the time origin without losing the tick count. For a tab regaining
     * focus: the next advance measures from the resume, not across the gap.
     */
    resume() {
      lastMs = null;
      accumulator = 0;
    },
  };
}
