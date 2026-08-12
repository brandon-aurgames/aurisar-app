/**
 * playoutClock — converts "now, locally" into "the server moment to draw".
 *
 * PURE. Observes arrivals, estimates the offset between the two clocks, and
 * answers one question: given the local time, which server timestamp should the
 * interpolator sample at?
 *
 * ─── Why this is not just `now - delay` ──────────────────────────────────────
 * Snapshots are stamped on the SERVER's clock; the render loop runs on the
 * CLIENT's. Those differ by an unknown amount — wall-clock skew plus one-way
 * network latency — and sampling at `localNow - delay` silently charges the
 * whole of that difference against the jitter budget. On an 80 ms link with a
 * 100 ms delay it leaves 20 ms of slack, so ordinary 60 ms jitter underruns
 * constantly and the actor stutters. Measured here before this module existed:
 * the actor spent most of its frames frozen and caught up in visible jumps.
 *
 * Estimating the offset first means the delay does the one job it was sized
 * for — absorbing VARIANCE — and base latency stops mattering at all.
 *
 * ─── Why the estimator tracks a minimum ──────────────────────────────────────
 * Every arrival gives `arrivalLocal - snapshotT`, which equals the true offset
 * PLUS that packet's queueing delay. Queueing delay is never negative, so the
 * smallest observation seen is the best estimate of the offset, and averaging
 * would instead track the mean jitter — biasing the clock later and later the
 * worse the link gets.
 *
 * The estimate SLEWS toward a new minimum rather than stepping to it. Stepping
 * was the first implementation and it was measurably wrong: render time is
 * `now − offset − delay`, so an instant drop in the offset teleports render
 * time forward, and on the 60 ms-jitter profile a single unusually fast packet
 * jumped the actor 0.25 m in one frame — 14.8 m/s, well past anything the
 * server would authorise. Every discontinuity the exit bar forbade was coming
 * from the clock, not from the interpolator. Rising works differently: the
 * estimate HOLDS at the window's minimum until the fast packet that set it
 * ages out, then steps up to the new minimum in one move. The step pushes
 * render time BACKWARDS, which the monotonic guard in renderTimeAt absorbs by
 * holding — so a stale fast packet cannot pin the estimate low forever, and
 * the correction still never reaches the screen as motion.
 *
 * ─── Why the delay adapts, and why it may only creep ─────────────────────────
 * NET_TIMING's two-interval delay is a FLOOR, not the whole answer. A link
 * whose jitter exceeds it underruns structurally, no matter how good the
 * interpolator is: measured on the 120 ms-jitter mobile profile against a fixed
 * 100 ms delay, 17% of frames had nothing to interpolate toward and the actor
 * caught up in 16.6 m/s lurches. So the delay grows to cover the jitter
 * actually observed — the classic de-jitter buffer, paying lag for continuity
 * exactly when the link demands it.
 *
 * Growth has to CREEP. Render time is `now − offset − delay`, so an abrupt
 * increase walks render time backwards and the actor moonwalks: the cure would
 * introduce the very discontinuity it exists to remove. Capping the per-
 * observation change well under a frame keeps render time monotonic — it
 * advances slightly slower than real time while the buffer deepens, which is
 * invisible. Shrinking is slower still, so one calm second on a bad link does
 * not collapse the buffer that is holding the picture together.
 */

import { NET_TIMING } from '../model/netTiming.js';

/**
 * Observations kept for the minimum/spread estimate. Four seconds at 20 Hz —
 * long enough that the window almost certainly contains one near-unimpeded
 * packet, short enough to follow a route change without a visible lag hangover.
 *
 * A WINDOW rather than an all-time minimum with a decay term: the decay version
 * shipped first and was subtly wrong. Pulling the estimate back up toward
 * recent readings biases it above the true minimum in proportion to the link's
 * own jitter (measured: 127 ms against a true offset of 40 ms on a 180 ms
 * spread), which left `jitterMs()` reporting the residual rather than the
 * jitter. The two errors cancelled in the render time, so the gate passed while
 * the diagnostic lied — and the next person to trust that number would have
 * sized something real off it.
 */
const WINDOW_SAMPLES = 80;

/**
 * How far the offset estimate may fall per observation, in ms. This is the knob
 * that turns a clock correction into a slew instead of a jump: it can never
 * move render time forward faster than a twentieth of a frame. Rising needs no
 * cap — a rising offset pushes render time backwards, and the monotonic guard
 * in renderTimeAt absorbs that by holding.
 */
const OFFSET_FALL_MS = 0.5;

/**
 * Beyond this, a high offset estimate is not jitter to slew through — it is a
 * dead timeline. A tab frozen for a minute (phone lock, hidden pane) delivers
 * its queued backlog on resume with stale stamps; those readings ratchet the
 * windowed minimum up, and once fresh packets flow again the estimate sits
 * SECONDS above truth with only the 0.5 ms/observation slew to unwind it —
 * measured live: 13.3 s of error, an ~8 minute unwind, 86% of frames pinned
 * to WARMUP the whole way. Past this gap the clock RESYNCS: one step down,
 * stale window readings purged, one visible snap — which after a real freeze
 * is correct, because the world genuinely moved on. Same doctrine as
 * simClock's spiral guard: the stall is lost, not replayed.
 */
const RESYNC_GAP_MS = 1000;

/** Headroom over measured jitter. Jitter is sampled, so the next packet can be worse. */
const JITTER_SAFETY = 1.3;

/**
 * Consecutive lost snapshots the buffer is sized to ride out.
 *
 * Jitter is not the only thing that starves the buffer: a DROPPED snapshot
 * leaves no late packet to wait for, just a hole, and the next stamp arrives a
 * whole cadence interval further on. Measured on the 5%-loss profile, two
 * consecutive drops opened a 150 ms hole against a 100 ms delay — the actor
 * froze for four frames and then closed the gap in one 0.28 m step (16.8 m/s),
 * which is exactly the discontinuity the exit bar forbids. Sizing for two lost
 * snapshots costs 100 ms of lag on a lossy link and removes the freeze.
 */
const LOSS_INTERVALS = 2;

/**
 * Per-observation bounds on delay change, in ms. Growth is capped far below a
 * 16.7 ms frame so render time keeps advancing; shrink is a quarter of that so
 * the buffer drains only on sustained calm.
 */
const DELAY_GROW_MS = 3;
const DELAY_SHRINK_MS = 0.25;

/**
 * Hard ceiling on the adaptive delay: the buffer's own reach, less one
 * interval. The snapshot buffer holds capacity × interval of history (400 ms
 * at the defaults); a delay pushed past that samples at server moments the
 * buffer has already evicted, so the sampler pins to the oldest snapshot it
 * still has — WARMUP forever, a frozen actor. From here on, worse jitter is a
 * link the interpolator cannot save, and freezing honestly beats pretending.
 */
const MAX_DELAY_MS = (NET_TIMING.bufferCapacity - 1) * NET_TIMING.snapshotIntervalMs;

export function createPlayoutClock({
  delayMs = NET_TIMING.interpolationDelayMs,
  windowSamples = WINDOW_SAMPLES,
  jitterSafety = JITTER_SAFETY,
} = {}) {
  const floorDelayMs = delayMs;
  let currentDelayMs = delayMs;
  let offsetMs = null;
  let jitterMs = 0;
  let observations = 0;
  let lastRenderTimeMs = null;

  /** Recent `arrival - stamp` readings; the estimator's whole memory. */
  const window = [];

  return {
    /**
     * Record that a snapshot stamped `snapshotT` was received at `localNowMs`.
     * @returns {number|null} the current offset estimate
     */
    observe(localNowMs, snapshotT) {
      if (!Number.isFinite(localNowMs) || !Number.isFinite(snapshotT)) return offsetMs;
      const seen = localNowMs - snapshotT;
      observations += 1;

      window.push(seen);
      if (window.length > windowSamples) window.shift();

      // The fastest packet in the window is the offset; the slowest one's lead
      // over it is the jitter. Both from one pass — the window is small and
      // this runs at the snapshot rate, not the frame rate.
      let windowMin = Infinity;
      let windowMax = -Infinity;
      for (const s of window) {
        if (s < windowMin) windowMin = s;
        if (s > windowMax) windowMax = s;
      }
      jitterMs = windowMax - windowMin;

      // Follow the window's minimum: instantly upward (render time moves
      // backwards, which the monotonic guard absorbs), slewed downward (render
      // time moves forwards, which is a visible lurch — see the header).
      // EXCEPT past the resync gap, where slewing means minutes of frozen
      // actors: step down once and drop the stale readings that caused it.
      if (offsetMs === null || windowMin > offsetMs) {
        offsetMs = windowMin;
      } else if (offsetMs - windowMin > RESYNC_GAP_MS) {
        offsetMs = windowMin;
        const keep = window.filter((v) => v - windowMin <= RESYNC_GAP_MS);
        window.length = 0;
        window.push(...keep);
        // Jitter re-derives from the purged window, so the dead timeline's
        // spread cannot pin the delay at its clamp for another 4 seconds.
        let mn = Infinity;
        let mx = -Infinity;
        for (const v of window) { if (v < mn) mn = v; if (v > mx) mx = v; }
        jitterMs = window.length ? mx - mn : 0;
      } else {
        offsetMs = Math.max(windowMin, offsetMs - OFFSET_FALL_MS);
      }

      const target = Math.min(
        MAX_DELAY_MS,
        Math.max(
          floorDelayMs,
          jitterMs * jitterSafety + NET_TIMING.snapshotIntervalMs * LOSS_INTERVALS,
        ),
      );
      const delta = target - currentDelayMs;
      currentDelayMs += delta > 0
        ? Math.min(delta, DELAY_GROW_MS)
        : Math.max(delta, -DELAY_SHRINK_MS);

      return offsetMs;
    },

    /**
     * The server moment to sample at. Before any observation there is no basis
     * for an estimate, so this returns null rather than guessing zero — a zero
     * offset would place render time a full latency ahead of anything received
     * and report a permanent underrun on the first frames.
     */
    renderTimeAt(localNowMs) {
      if (offsetMs === null) return null;
      const computed = localNowMs - offsetMs - currentDelayMs;

      // Render time may never run backwards, full stop. The per-observation
      // caps above make that overwhelmingly likely but not guaranteed: a burst
      // of arrivals inside a single frame (a stalled tab delivering its whole
      // backlog at once) can grow the delay by more than the frame advanced,
      // and the actor would visibly moonwalk. Holding instead means render time
      // pauses for a frame or two while real time catches up, which is
      // invisible — an interpolated actor simply keeps its position.
      if (lastRenderTimeMs !== null && computed < lastRenderTimeMs) return lastRenderTimeMs;
      lastRenderTimeMs = computed;
      return computed;
    },

    offset: () => offsetMs,
    /** The delay in force right now — at or above the NET_TIMING floor. */
    delayMs: () => currentDelayMs,
    /** Measured jitter driving the delay. A link-quality readout for the HUD. */
    jitterMs: () => jitterMs,
    observationCount: () => observations,
    reset() {
      offsetMs = null;
      jitterMs = 0;
      currentDelayMs = floorDelayMs;
      observations = 0;
      lastRenderTimeMs = null;
      window.length = 0;
    },
  };
}
