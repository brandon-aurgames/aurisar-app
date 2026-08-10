/**
 * LatencyShapedTransport — a real network's bad manners, deterministically.
 *
 * PURE. Wraps any WorldTransport and holds its inbound events back: each one
 * gets an admission time (`now() + latency + jitter`), and nothing reaches a
 * subscriber before that time arrives. Reordering is not simulated separately —
 * it falls out, exactly as it does on a real link, when a jittered event is
 * admitted after one that was sent later.
 *
 * ─── Why a decorator and not a flag on LocalTransport ────────────────────────
 * LocalTransport's header commits to synchronous settles, and a dozen existing
 * tests depend on that. Bolting a latency mode inside it would put a branch
 * through the one module that is supposed to be "the real authoritative logic,
 * just in-process". A decorator leaves that determinism untouched and composes
 * with whatever transport P12 ships.
 *
 * ─── THE CLOCK MUST BE SHARED ────────────────────────────────────────────────
 * `now` is required, and it must be the SAME function handed to the wrapped
 * transport. LocalTransport computes a move's dt as `now() - row.lastMoveAtMs`
 * at delivery time, and moveRules floors dt at 1 ms — so two clocks drifting
 * apart hands a moveIntent a near-zero dt, a ~9 mm movement budget, an
 * automatic CLAMPED_SPEED verdict and a RECONCILE. The result is rubber-banding
 * manufactured by the test harness, which reads exactly like an interpolator
 * bug and is not one. Sharing the clock is the whole defence.
 *
 * ─── Inbound only, deliberately ──────────────────────────────────────────────
 * Only server→client events are shaped. Delaying outbound `send()` would leave
 * its promise unresolved until something pumped the queue — a deadlock for any
 * caller that awaits a command, which dispatch does. Round-trip shaping belongs
 * with prediction and reconciliation in P8b, where there is a frame loop to
 * pump it and a reason to want it.
 */

import { EVENT } from '../WorldTransport.js';
import { hash2 } from '../../model/noise.js';

/**
 * Named link conditions, so the exit bar reads as a matrix rather than a pile
 * of magic numbers. `drop` applies to state snapshots only — see enqueue().
 */
export const LINK_PROFILES = Object.freeze({
  LAN: Object.freeze({ latencyMs: 5, jitterMs: 2, dropRate: 0 }),
  BROADBAND: Object.freeze({ latencyMs: 40, jitterMs: 15, dropRate: 0.01 }),
  FLAKY_WIFI: Object.freeze({ latencyMs: 80, jitterMs: 60, dropRate: 0.05 }),
  MOBILE_3G: Object.freeze({ latencyMs: 200, jitterMs: 120, dropRate: 0.08 }),
});

export function createLatencyShapedTransport(inner, {
  now,
  latencyMs = 0,
  jitterMs = 0,
  dropRate = 0,
  seed = 1,
} = {}) {
  if (typeof now !== 'function') {
    throw new Error('[LatencyShapedTransport] `now` is required and must be the wrapped transport’s clock');
  }
  if (!(latencyMs >= 0) || !(jitterMs >= 0)) {
    throw new Error('[LatencyShapedTransport] latencyMs and jitterMs must be non-negative');
  }

  const subscribers = new Set();
  /** Pending deliveries, ascending by (dueMs, ord). */
  const queue = [];
  let ord = 0;
  let dropped = 0;
  let delivered = 0;

  function deliver(kind, payload) {
    delivered += 1;
    for (const fn of [...subscribers]) {
      try {
        fn(kind, payload);
      } catch (err) {
        console.error('[LatencyShapedTransport] subscriber threw:', err);
      }
    }
  }

  function enqueue(kind, payload) {
    const index = ord++;

    // Loss applies to state snapshots only. Dropping a CONNECTION would desync
    // the client's own notion of being online, and dropping a RECONCILE would
    // strand a prediction that the server has already overruled — neither is a
    // thing a link does to you in a way the client is expected to absorb. A
    // missing ENTITY_UPSERT is exactly what packet loss looks like, and
    // surviving it is what the interpolation buffer is for.
    if (kind === EVENT.ENTITY_UPSERT && dropRate > 0
        && hash2(index, 1, seed) < dropRate) {
      dropped += 1;
      return;
    }

    // Jitter is one-sided: a packet can be later than the base latency, never
    // earlier. Two-sided jitter would let an event be admitted before it was
    // physically possible for it to arrive.
    const dueMs = now() + latencyMs + hash2(index, 0, seed) * jitterMs;

    // Insert sorted, tie-broken by arrival index so a given seed always
    // produces one exact delivery order. Two events sharing a due-time with an
    // unstable tie-break would make the whole harness non-reproducible.
    let i = queue.length;
    while (i > 0 && (queue[i - 1].dueMs > dueMs
      || (queue[i - 1].dueMs === dueMs && queue[i - 1].ord > index))) i--;
    queue.splice(i, 0, { dueMs, ord: index, kind, payload });
  }

  const unsubscribeInner = inner.subscribe(enqueue);

  return {
    connect: (id) => inner.connect(id),
    isConnected: () => inner.isConnected(),
    send: (command, payload, seq) => inner.send(command, payload, seq),

    async disconnect() {
      return inner.disconnect();
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    // ── Shaper-only surface, deliberately outside the WorldTransport contract.

    /**
     * Release everything admitted by `nowMs`. The frame loop calls this once
     * per tick; tests call it to step a schedule.
     * @returns {number} events delivered
     */
    pump(nowMs) {
      let n = 0;
      while (queue.length && queue[0].dueMs <= nowMs) {
        const item = queue.shift();
        deliver(item.kind, item.payload);
        n += 1;
      }
      return n;
    },

    /** Deliver everything still queued, ignoring time. The conformance `settle`. */
    settle() {
      while (queue.length) {
        const item = queue.shift();
        deliver(item.kind, item.payload);
      }
    },

    /** Queued-but-undelivered count — a jitter-budget diagnostic. */
    pendingCount: () => queue.length,
    droppedCount: () => dropped,
    deliveredCount: () => delivered,

    /** Stop shaping and release the inner subscription. */
    dispose() {
      unsubscribeInner?.();
      subscribers.clear();
      queue.length = 0;
    },
  };
}
