/**
 * LocalTransport — the authoritative world, running in-process.
 *
 * PURE (no BABYLON, no DOM, no network). Implements the WorldTransport contract
 * against a memoryDb instead of a server.
 *
 * This is NOT a mock. The gameplay decisions live in shared rules modules
 * (rules/moveRules.js today; combat/resources later), and this transport calls
 * exactly the code the SpacetimeDB reducer will call. What is faked is only the
 * plumbing: no socket, no auth, and send() settles synchronously — there is no
 * latency hook (tests that need delayed settles script their own transport, as
 * dispatch.test.js does). That is what lets offline dev, unit tests and the
 * no-auth viewer exercise real behaviour instead of a copy that drifts.
 *
 * Time is injected (`now`) rather than read from Date.now(), so tests are
 * deterministic and a forged-dt scenario is expressible.
 *
 * ─── A transport is a CONNECTION to a world, not the world itself (P8) ───────
 * The world (tables + fan-out) lives in localWorld.js, so several transports
 * can share one. Passing no world still builds a private one, which is what
 * every single-client caller wants and what P1–P7 assumed.
 */

import {
  EVENT,
  REJECT,
  ack,
  nack,
} from '../WorldTransport.js';
import { createLocalWorld, TABLES } from './localWorld.js';
import { resolveMove, MOVE_LIMITS } from '../rules/moveRules.js';
import { packId } from '../InputSnapshot.js';

export { TABLES };

/** Where a fresh player stands. Provisional until worldgen lands in P2. */
const SPAWN = Object.freeze({ x: 0, z: 0, yaw: 0 });
const PLAYER_MAX_HP = 100;

export function createLocalTransport({ now = () => 0, world = createLocalWorld() } = {}) {
  const db = world.db;
  const subscribers = new Set();
  let identity = null;
  let connected = false;

  /** Deliver to THIS client only: connection state, and corrections addressed to it. */
  function emit(kind, payload) {
    for (const fn of [...subscribers]) {
      try {
        fn(kind, payload);
      } catch (err) {
        console.error('[LocalTransport] subscriber threw:', err);
      }
    }
  }

  /** Deliver to every client attached to the same world. */
  const emitWorld = (kind, payload) => world.broadcast(kind, payload);

  const detach = world.attach(emit);

  /**
   * Public row shape — a copy, never the live reference. Server-internal
   * bookkeeping (move timing) stays out of the event stream.
   *
   * `t` is the SERVER time this state was true, and it is what the client's
   * interpolation buffer keys on. Without it a client can only order snapshots
   * by arrival, which under jitter is the very noise interpolation exists to
   * remove. `originSeq` names the command that produced the row (null when
   * nothing did), so a client can recognise the echo of its own prediction
   * instead of treating a delayed self-update as a correction from elsewhere.
   */
  const playerView = (row, { t = now(), originSeq = null } = {}) => {
    const { lastMoveAtMs: _timing, online: _presence, ...view } = row;
    return { ...view, t, originSeq };
  };

  /**
   * The departure broadcast, once. Both disconnect() and dispose() land here,
   * in either order, so the guard lives in one place: without it a
   * disconnect-then-dispose (the normal teardown sequence) would announce the
   * same departure twice and a hub would tear down a slot that was already
   * recycled. The row itself stays — reconnect resumes it, P1 semantics — but
   * `online: false` keeps it out of every future joiner's initial sync.
   * Leaving the row in WITH no flag was the ghost bug: the joiner's sync
   * resurrected departed players at their last position, forever, because the
   * REMOVE that would have cleaned them up had been broadcast before the
   * joiner existed to hear it.
   */
  function depart() {
    if (!connected || identity == null) return;
    connected = false;
    db.upsert('player', identity, { online: false });
    emitWorld(EVENT.ENTITY_REMOVE, { id: identity });
  }

  const commands = {
    /**
     * moveIntent — the client's claimed position for `seq`.
     * Mirrors what the SpacetimeDB movePlayer reducer will do: resolve via the
     * shared rules, write the verdict, and emit a RECONCILE only when clamped —
     * an accepted move needs no correction.
     */
    moveIntent(payload, seq) {
      const me = db.get('player', identity);
      if (!me) return nack(seq, REJECT.NOT_FOUND, 'player not spawned');

      const tMs = now();
      // Move timing lives ON THE ROW, not in transport memory. A transport-
      // local variable reset by connect() let disconnect→reconnect mint a fresh
      // full budget at the same timestamp — a ~9.45m free hop per reconnect
      // (verified before fixing). Row storage survives reconnects, is
      // per-player by construction, and matches where a SpacetimeDB reducer
      // would keep it.
      const dtMs = me.lastMoveAtMs == null ? MOVE_LIMITS.maxDtMs : tMs - me.lastMoveAtMs;
      const r = resolveMove(me, { x: payload?.x, z: payload?.z }, dtMs);

      if (r.verdict === 'rejected_nan') {
        return nack(seq, REJECT.INVALID_PAYLOAD, 'non-finite position');
      }

      const yaw = Number.isFinite(payload?.yaw) ? payload.yaw : me.yaw;
      const updated = db.upsert('player', identity, { x: r.x, z: r.z, yaw, lastMoveAtMs: tMs });

      // Stamped with the move's own time, not now(): the two are equal here,
      // but a reducer that batches would make them differ, and the buffer must
      // key on when the state was TRUE rather than when it was sent.
      emitWorld(EVENT.ENTITY_UPSERT, playerView(updated, { t: tMs, originSeq: seq }));
      if (!r.accepted) {
        // A correction is addressed to the client that overreached. Broadcasting
        // it would tell every other client to move too.
        emit(EVENT.RECONCILE, { seq, x: r.x, z: r.z, yaw });
      }
      return ack(seq, { x: r.x, z: r.z, accepted: r.accepted });
    },

    /** setTarget — validated identity write, mirrored to interested clients. */
    setTarget(payload, seq) {
      const me = db.get('player', identity);
      if (!me) return nack(seq, REJECT.NOT_FOUND, 'player not spawned');

      const targetId = payload?.targetId == null ? null : packId(payload.targetId);
      if (targetId !== null && !db.has('mob', targetId)) {
        return nack(seq, REJECT.INVALID_TARGET, `no such mob ${targetId}`);
      }
      const updated = db.upsert('player', identity, { targetId });
      emitWorld(EVENT.ENTITY_UPSERT, playerView(updated, { originSeq: seq }));
      return ack(seq, { targetId });
    },
  };

  return {
    async connect(id) {
      if (id == null || id === '') throw new Error('[LocalTransport] identity required');
      identity = packId(id);
      connected = true;

      // Spawn (or resume) the player — same row shape the reducer will keep.
      // On resume, the row arrives with its lastMoveAtMs intact: "no last move"
      // means a true first spawn, never a reconnect.
      const existing = db.get('player', identity);
      const row = existing
        ? db.upsert('player', identity, { online: true })
        : db.upsert('player', identity, {
          ...SPAWN,
          hp: PLAYER_MAX_HP,
          maxHp: PLAYER_MAX_HP,
          targetId: null,
          lastMoveAtMs: null,
          online: true,
        });

      emit(EVENT.CONNECTION, { connected: true, reason: 'local' });

      // Initial state sync: this client has never heard about anyone already
      // standing in the world. Without it, a second player only becomes visible
      // when they next move — so a stationary occupant would be invisible
      // forever, which reads as "remote players are broken" rather than as a
      // missing sync. Addressed to this client only; everyone else knows.
      // OFFLINE rows are skipped: they are resume state, not occupants, and
      // syncing them resurrects departed players as ghosts (their REMOVE was
      // broadcast before this client existed to hear it).
      for (const other of db.rows('player')) {
        if (other.id !== identity && other.online) emit(EVENT.ENTITY_UPSERT, playerView(other));
      }

      // The joiner itself goes to the whole world, so existing clients learn
      // about it at the moment it arrives.
      emitWorld(EVENT.ENTITY_UPSERT, playerView(row));
    },

    async disconnect() {
      // Departure first, connection notice second, so a client tearing itself
      // down still forwards the removal to the world before going quiet.
      // ENTITY_REMOVE has been defined since P1 and emitted by nothing; a hub
      // that never receives it leaks an actor per departure.
      depart();
      emit(EVENT.CONNECTION, { connected: false, reason: 'local-disconnect' });
    },

    isConnected: () => connected,

    async send(command, payload, seq) {
      if (!connected) return nack(seq, REJECT.NOT_CONNECTED, 'not connected');
      const handler = commands[command];
      if (!handler) return nack(seq, REJECT.UNKNOWN_COMMAND, `no command "${command}"`);
      return handler(payload, seq);
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    /**
     * Tear down this client. A dispose while still connected IS a departure —
     * the churning-demo path never calls disconnect() first, and peers left
     * holding the actor would keep its rig and scene-registered skeleton alive
     * with nothing ever to remove them.
     *
     * Detach FIRST, announce second. detach() removes only this client's own
     * port, so the departure broadcast still reaches every remaining peer —
     * while the disposed transport itself, which promised to deliver nothing
     * after dispose, does not hear its own removal.
     */
    dispose() {
      detach();
      depart();
      subscribers.clear();
    },

    // ── Test/dev-only surface, deliberately outside the WorldTransport contract.
    /** Seed a mob so targeting has something to hit. */
    _seedMob(id, row = {}) {
      return db.upsert('mob', id, { hp: 50, maxHp: 50, x: 5, z: 5, ...row });
    },
    _db: db,
    _world: world,
  };
}
