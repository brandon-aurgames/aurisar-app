/**
 * interpolate — where a remote actor is drawn, given what has arrived so far.
 *
 * PURE. No BABYLON, no clock, no transport. `sampleSnapshots` is a function of
 * (snapshots, renderTimeMs) and nothing else, which is what lets the exit-bar
 * gate replay a pathological delivery schedule headlessly and assert on the
 * resulting motion.
 *
 * ─── The whole idea in three lines ───────────────────────────────────────────
 * Snapshots arrive stamped with server time. The renderer asks for a moment
 * slightly in the past (see model/netTiming.js), finds the two snapshots
 * bracketing it, and blends. Everything else in this file is what to do when
 * that bracket does not exist.
 *
 * ─── Out-of-order arrival is normal, not an error ────────────────────────────
 * The buffer sorts on insert instead of assuming arrival order. A jittered
 * network delivers snapshot N+1 before N routinely, and a buffer that appended
 * blindly would produce a non-monotonic timeline: the sampler's bracket search
 * would then straddle a backwards pair and the actor would lurch. Sorting on
 * insert costs a splice into an eight-element array and removes the failure
 * mode entirely.
 *
 * ─── Never extrapolate ───────────────────────────────────────────────────────
 * When nothing newer has arrived, this holds the last known position rather than
 * dead-reckoning forward. Extrapolation looks better for the ~50 ms it stays
 * plausible and then produces a visible snap back to truth, which reads worse
 * than the freeze it was trying to hide — and it invents positions the server
 * never authorised, which is exactly what a client should not do.
 */

import { NET_TIMING } from '../model/netTiming.js';

export const INTERP_MODE = Object.freeze({
  /** Blended between two real snapshots. The healthy case. */
  INTERPOLATED: 'interpolated',
  /** Nothing newer has arrived — holding the newest known position. */
  UNDERRUN: 'underrun',
  /** Render time precedes everything buffered — holding the oldest. */
  WARMUP: 'warmup',
  /** The gap was too fast to be movement; jumped instead of sliding. */
  SNAPPED: 'snapped',
});

const TAU = Math.PI * 2;

/**
 * Shortest-arc angle blend.
 *
 * Yaw arrives as `atan2` output in (−π, π], so a player turning through south
 * hands us a pair like (3.10, −3.10): a plain lerp takes the 6.2-radian route
 * the long way round the compass while the actor was physically turning 0.08
 * radians. The wrap below is the difference between "turns slightly" and "spins
 * a full revolution between two snapshots".
 */
export function lerpAngle(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return normalizeAngle(a + d * t);
}

/**
 * Fold an angle back into [−π, π) — the same domain `atan2` produces.
 *
 * Without this, blending toward a wrapped target returns a value congruent to
 * the answer but outside the input domain: lerpAngle(1.2, −2.9, 1) yields 3.38
 * rather than −2.9. Both point the same way and Babylon renders them
 * identically, so the bug would never be visible — it would surface later, in
 * whatever first compares two yaws or thresholds on `Math.abs(yaw)`.
 */
export function normalizeAngle(a) {
  const wrapped = ((a + Math.PI) % TAU + TAU) % TAU;
  return wrapped - Math.PI;
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Blend two snapshots at a moment between them.
 *
 * @param {{t:number,x:number,z:number,yaw:number}} a  older
 * @param {{t:number,x:number,z:number,yaw:number}} b  newer
 * @returns {{x:number,z:number,yaw:number,mode:string}}
 */
function blend(a, b, renderTimeMs, teleportSpeedMps) {
  const span = b.t - a.t;
  if (!(span > 0)) return { x: b.x, z: b.z, yaw: b.yaw, mode: INTERP_MODE.SNAPPED };

  // A gap no honest player could have walked is a spawn, a rejoin, or a
  // resurrect. Sliding through it draws an actor skating across the map at
  // impossible speed for a whole buffer window; popping is the lesser evil and
  // is what every shipped client does.
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  if (dist / (span / 1000) > teleportSpeedMps) {
    return { x: b.x, z: b.z, yaw: b.yaw, mode: INTERP_MODE.SNAPPED };
  }

  const f = (renderTimeMs - a.t) / span;
  return {
    x: lerp(a.x, b.x, f),
    z: lerp(a.z, b.z, f),
    yaw: lerpAngle(a.yaw, b.yaw, f),
    mode: INTERP_MODE.INTERPOLATED,
  };
}

/**
 * Where to draw, given every snapshot held for one actor.
 *
 * `snapshots` must be ascending by `t` — createSnapshotBuffer guarantees that.
 * Returns null only for an empty buffer, so callers distinguish "no actor yet"
 * from "actor, but stalled".
 */
export function sampleSnapshots(snapshots, renderTimeMs, {
  teleportSpeedMps = NET_TIMING.teleportSpeedMps,
} = {}) {
  const n = snapshots.length;
  if (n === 0) return null;

  const oldest = snapshots[0];
  const newest = snapshots[n - 1];

  // Render time has not reached the buffer yet: the actor just appeared and the
  // delay window is still filling. Holding the oldest known pose is right —
  // there is no earlier truth to blend toward.
  if (renderTimeMs <= oldest.t) {
    return { x: oldest.x, z: oldest.z, yaw: oldest.yaw, mode: INTERP_MODE.WARMUP };
  }

  // Nothing newer has arrived. Hold, never extrapolate (see the header).
  if (renderTimeMs >= newest.t) {
    return { x: newest.x, z: newest.z, yaw: newest.yaw, mode: INTERP_MODE.UNDERRUN };
  }

  // Linear scan: the buffer is eight entries and the answer is almost always in
  // the last two. A binary search here would be more code and slower.
  for (let i = n - 1; i > 0; i--) {
    if (snapshots[i - 1].t <= renderTimeMs) {
      return blend(snapshots[i - 1], snapshots[i], renderTimeMs, teleportSpeedMps);
    }
  }
  return blend(oldest, snapshots[1], renderTimeMs, teleportSpeedMps);
}

/**
 * A per-actor ring of recent snapshots, ordered by server time.
 *
 * Deliberately dumb about identity: the caller decides which actor this belongs
 * to. Epoch gating (rejecting a snapshot meant for a since-despawned occupant of
 * a recycled slot) is the actor hub's job in P8b, and doing it here would mean
 * this module needed to know what an actor is.
 */
export function createSnapshotBuffer({
  capacity = NET_TIMING.bufferCapacity,
  teleportSpeedMps = NET_TIMING.teleportSpeedMps,
} = {}) {
  if (!(capacity >= 2)) throw new Error('[interpolate] capacity must be at least 2');

  /** @type {{t:number,x:number,z:number,yaw:number}[]} ascending by t */
  const snaps = [];
  let dropped = 0;

  return {
    /**
     * @returns {boolean} whether the snapshot was retained. A false means it
     *   arrived too late to matter — worth counting, never worth throwing over.
     */
    push(snap) {
      if (!snap || !Number.isFinite(snap.t)) return false;
      if (!Number.isFinite(snap.x) || !Number.isFinite(snap.z)) return false;

      const row = { t: snap.t, x: snap.x, z: snap.z, yaw: Number.isFinite(snap.yaw) ? snap.yaw : 0 };

      // Full buffer and older than everything in it: this snapshot is pure
      // history. Inserting it would evict a newer one the renderer has not
      // reached yet — trading a useful future for a useless past.
      if (snaps.length >= capacity && row.t < snaps[0].t) {
        dropped += 1;
        return false;
      }

      let i = snaps.length;
      while (i > 0 && snaps[i - 1].t > row.t) i--;

      // Same stamp arriving twice (a duplicate delivery): replace rather than
      // grow, so the timeline never contains a zero-length span.
      if (i > 0 && snaps[i - 1].t === row.t) snaps[i - 1] = row;
      else snaps.splice(i, 0, row);

      while (snaps.length > capacity) snaps.shift();
      return true;
    },

    sample: (renderTimeMs) => sampleSnapshots(snaps, renderTimeMs, { teleportSpeedMps }),

    newest: () => (snaps.length ? snaps[snaps.length - 1] : null),
    oldest: () => (snaps.length ? snaps[0] : null),
    size: () => snaps.length,
    /** Snapshots discarded for arriving too late. A jitter-budget diagnostic. */
    droppedCount: () => dropped,
    /** Read-only view for tests and diagnostics. */
    toArray: () => snaps.map((s) => ({ ...s })),
    clear() {
      snaps.length = 0;
      dropped = 0;
    },
  };
}
