/**
 * PlaybackTransport — a scripted world, for asserting on motion.
 *
 * PURE. Satisfies the WorldTransport contract, but its event stream comes from
 * a fixed script rather than from any simulation: connect, then pump a clock,
 * and the scripted events come out at their scripted times.
 *
 * ─── Why the exit-bar gate uses this and not LocalTransport ──────────────────
 * LocalTransport is single-occupant and only ever emits the local player's own
 * row, so it cannot produce a remote actor to interpolate at all. More
 * importantly, a gate built on it would be asserting against a position the
 * simulation just computed — if the rules and the interpolator ever drift the
 * same way, the test moves with them and proves nothing. A script is an
 * independent oracle: the exact path is known in advance, so "did the rendered
 * motion stay smooth and track the truth" is a real question with a real answer.
 *
 * The multi-client shared-world arm (N LocalTransports over one memoryDb) is
 * what the eyeball demo runs on; this is what CI runs on. Both exist on purpose.
 */

import { EVENT, REJECT, ack, nack } from '../WorldTransport.js';
import { normalizeAngle } from '../interpolate.js';
import { NET_TIMING } from '../../model/netTiming.js';

/**
 * A remote actor walking a circle at constant speed.
 *
 * Circular rather than straight-line on purpose: a circle sweeps yaw through
 * the entire compass including the ±π seam, so any interpolator that lerps
 * angles the long way round is caught by the same fixture that checks position.
 * A straight line would hold yaw constant and never exercise it.
 *
 * @returns {{atMs: number, kind: string, payload: object}[]} ascending by atMs
 */
export function scriptCircle({
  id = 'remote-1',
  startMs = 0,
  durationMs = 4000,
  hz = NET_TIMING.snapshotHz,
  radiusM = 8,
  speedMps = 4.2,
} = {}) {
  if (!(radiusM > 0)) throw new Error('[PlaybackTransport] radiusM must be positive');
  const intervalMs = 1000 / hz;
  const omega = speedMps / radiusM; // rad/s
  const out = [];

  for (let t = 0; t <= durationMs; t += intervalMs) {
    const a = (omega * t) / 1000;
    // Velocity is (-sin a, cos a) * speed; the walker's forward convention is
    // (sin yaw, cos yaw), so yaw = atan2(vx, vz).
    out.push({
      atMs: startMs + t,
      kind: EVENT.ENTITY_UPSERT,
      payload: {
        id,
        t: startMs + t,
        x: radiusM * Math.cos(a),
        z: radiusM * Math.sin(a),
        yaw: normalizeAngle(Math.atan2(-Math.sin(a), Math.cos(a))),
      },
    });
  }
  return out;
}

/** The exact position the script describes at an arbitrary moment — the oracle. */
export function circleTruthAt(tMs, { startMs = 0, radiusM = 8, speedMps = 4.2 } = {}) {
  const a = (speedMps / radiusM) * ((tMs - startMs) / 1000);
  return { x: radiusM * Math.cos(a), z: radiusM * Math.sin(a) };
}

export function createPlaybackTransport({ now, script = [] } = {}) {
  if (typeof now !== 'function') {
    throw new Error('[PlaybackTransport] `now` is required');
  }

  const subscribers = new Set();
  const pending = [...script].sort((a, b) => a.atMs - b.atMs);
  let connected = false;
  let cursor = 0;

  function emit(kind, payload) {
    for (const fn of [...subscribers]) {
      try {
        fn(kind, payload);
      } catch (err) {
        console.error('[PlaybackTransport] subscriber threw:', err);
      }
    }
  }

  return {
    async connect(id) {
      if (id == null || id === '') throw new Error('[PlaybackTransport] identity required');
      connected = true;
      emit(EVENT.CONNECTION, { connected: true, reason: 'playback' });
    },

    async disconnect() {
      connected = false;
      emit(EVENT.CONNECTION, { connected: false, reason: 'playback-disconnect' });
    },

    isConnected: () => connected,

    /**
     * There is no gameplay surface here — a script does not take orders. The
     * contract still has to be honoured, so refusals carry the right codes
     * rather than throwing.
     */
    async send(command, _payload, seq) {
      if (!connected) return nack(seq, REJECT.NOT_CONNECTED, 'not connected');
      if (command === 'noop') return ack(seq, null);
      return nack(seq, REJECT.UNKNOWN_COMMAND, `playback has no command "${command}"`);
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    // ── Playback-only surface, outside the WorldTransport contract.

    /** Emit everything scheduled at or before `nowMs`. @returns {number} emitted */
    pump(nowMs) {
      let n = 0;
      while (cursor < pending.length && pending[cursor].atMs <= nowMs) {
        const item = pending[cursor++];
        emit(item.kind, item.payload);
        n += 1;
      }
      return n;
    },

    /** Emit the whole remaining script. The conformance `settle`. */
    settle() {
      while (cursor < pending.length) {
        const item = pending[cursor++];
        emit(item.kind, item.payload);
      }
    },

    remainingCount: () => pending.length - cursor,
    /** The clock this transport was built with, so a shaper can share it. */
    now,
  };
}
