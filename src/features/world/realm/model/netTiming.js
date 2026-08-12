/**
 * netTiming — the numbers that decide how far behind "now" a remote actor renders.
 *
 * PURE. Constants and the two derivations that must never drift apart from them.
 *
 * ─── Why remote actors render in the past ────────────────────────────────────
 * Snapshots arrive at a cadence, late, and out of order. To draw a remote player
 * at time T you need snapshots on BOTH sides of T, so the renderer deliberately
 * runs `interpolationDelayMs` behind the newest thing it has heard. That delay is
 * the entire budget for absorbing jitter: a snapshot that arrives later than the
 * delay allows is a buffer underrun, and the actor freezes until it catches up.
 *
 * The delay is expressed as a MULTIPLE OF THE SNAPSHOT INTERVAL rather than a
 * flat 100 ms. A flat constant silently stops meaning anything the moment the
 * cadence changes: at 20 Hz, 100 ms is two snapshots of slack; at 10 Hz it is
 * one, which leaves zero margin, and at 60 Hz it is six, which is needless lag
 * nobody would have chosen deliberately. Two intervals is the smallest delay
 * that still has a snapshot in hand when exactly one goes missing.
 *
 * ─── Keying on server time, not on tick numbers ──────────────────────────────
 * Snapshots are stamped with the SERVER's clock (`t`, milliseconds) and the
 * client renders at `now - interpolationDelayMs` on its own clock. The tempting
 * alternative — agree on an integer tick and interpolate by tick number —
 * requires the client and server to run the same fixed timestep. LocalTransport
 * could honour that; SpacetimeDB is event-driven and has no 60 Hz tick to
 * borrow, so P12 would have had to invent one. Server-time keying costs nothing
 * here and is the only scheme both arms can implement.
 */

export const NET_TIMING = Object.freeze({
  /**
   * Server→client snapshot cadence. 20 Hz is the low end of what shipped MMOs
   * use, chosen deliberately: a cadence high enough to hide the interpolator's
   * work would let a broken interpolator pass. At 50 ms apart, a lerp bug is
   * visible.
   */
  snapshotHz: 20,
  snapshotIntervalMs: 50,

  /** Render delay, in snapshot intervals. See the header for why it is a multiple. */
  delayIntervals: 2,
  interpolationDelayMs: 100,

  /**
   * Snapshots retained per actor. Must cover the delay plus the worst jitter
   * that still counts as recoverable — below this the buffer evicts a snapshot
   * the renderer has not reached yet, which reads as a stutter no interpolator
   * can fix. Eight at 20 Hz is 400 ms of history against a 100 ms delay.
   */
  bufferCapacity: 8,

  /**
   * Above this implied speed, a gap between two snapshots is a TELEPORT, not
   * motion: the actor is snapped rather than slid.
   *
   * The server never permits a sustained 9.45 m/s (moveRules: 7 m/s × 1.35
   * tolerance), so anything above that is not locomotion — it is a spawn, a
   * rejoin across the map, or a resurrect. Interpolating those produces an actor
   * skating across the world at implausible speed, which reads far worse than a
   * pop. The threshold sits at 20 rather than snug against 9.45 because a
   * single late snapshot pair legitimately implies a burst well above the
   * sustained cap, and snapping honest movement is the worse failure.
   */
  teleportSpeedMps: 20,
});

/**
 * The two derived fields above, recomputed. Tests assert these against the
 * frozen literals so a hand-edited cadence cannot leave a stale interval or
 * delay behind — the failure that would otherwise ship is silent, because every
 * number involved stays individually plausible.
 */
export const derivedIntervalMs = (hz = NET_TIMING.snapshotHz) => 1000 / hz;
export const derivedDelayMs = (
  intervalMs = NET_TIMING.snapshotIntervalMs,
  intervals = NET_TIMING.delayIntervals,
) => intervalMs * intervals;
