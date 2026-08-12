/**
 * remoteActorHub — every remote actor the client currently believes in.
 *
 * PURE. Sits between the transport's event stream and the view's roster: it
 * ingests ENTITY_UPSERT/ENTITY_REMOVE, owns one playout clock and one snapshot
 * buffer per actor, and answers one question per frame — who exists, and where
 * should each of them be drawn right now.
 *
 * ─── Flat registry, one clock ────────────────────────────────────────────────
 * A Map of id → slot, no hierarchy. Individual actors never see a clock: the
 * hub observes every arrival into ONE playout clock, because all snapshots in
 * a world are stamped by the same server — per-actor clocks would let N actors
 * drift on N independently-converging offsets, which is a failure mode, not a
 * feature.
 *
 * ─── The epoch, and what it actually gates ───────────────────────────────────
 * Every spawn gets a fresh epoch, and a respawned id is a NEW actor as far as
 * the view is concerned: the roster keys rigs by id#epoch, so a stale rig can
 * never be re-used for a new occupant of the same id.
 *
 * The subtle half is INGESTION. Under a jittering link, a delayed UPSERT can
 * be admitted after the REMOVE that outranks it — and a hub that treated any
 * unknown id as a fresh spawn would resurrect the departed actor as a ghost,
 * one the server will never REMOVE again because, as far as it knows, it
 * already did. So a REMOVE leaves a tombstone carrying the departure's server
 * time, and an UPSERT for a tombstoned id must be STRICTLY NEWER than the
 * departure to count as a genuine respawn. Stale echoes die at the door.
 *
 * ─── The ceiling becomes real here ───────────────────────────────────────────
 * ACTOR_CEILINGS.maxSimultaneousActors has been test-only since P6 —
 * actorBudget.js says outright "NOTHING AT RUNTIME READS EITHER NUMBER" and
 * assigns enforcement to whichever phase first spawns actors dynamically.
 * That is this phase. At the ceiling, new spawns are refused and counted;
 * refusal degrades to "fewer players rendered", which beats rendering a crowd
 * the budgets never priced.
 */

import { EVENT } from './WorldTransport.js';
import { createSnapshotBuffer } from './interpolate.js';
import { createPlayoutClock } from './playoutClock.js';
import { ACTOR_CEILINGS } from '../model/actorBudget.js';

/**
 * Departed ids remembered against late echoes. Bounded because an interest-
 * range world churns actors indefinitely and an unbounded Map is a leak; 64
 * covers every actor the ceiling allows plus a deep backlog of recent leavers.
 * Eviction is insertion-order (Map iteration order), which approximates
 * oldest-departure-first closely enough for a staleness guard.
 */
const MAX_TOMBSTONES = 64;

export function createRemoteActorHub({
  localId = null,
  maxActors = ACTOR_CEILINGS.maxSimultaneousActors,
  clock = createPlayoutClock(),
} = {}) {
  /** @type {Map<string, {epoch: number, buffer: object, row: object}>} */
  const slots = new Map();
  /** @type {Map<string, number>} id → server time of its departure */
  const tombstones = new Map();
  let nextEpoch = 1;
  let refused = 0;
  let staleDropped = 0;

  function bury(id, t) {
    tombstones.delete(id); // re-insert to refresh Map order
    tombstones.set(id, t);
    while (tombstones.size > MAX_TOMBSTONES) {
      tombstones.delete(tombstones.keys().next().value);
    }
  }

  return {
    /**
     * Feed one transport event in. Wire directly:
     *   transport.subscribe((kind, payload) => hub.ingest(kind, payload, now()))
     * Unrecognised kinds are ignored — CONNECTION and RECONCILE belong to the
     * local player's pipeline, not to remote presence.
     */
    ingest(kind, payload, localNowMs) {
      if (kind === EVENT.ENTITY_REMOVE) {
        const id = payload?.id == null ? null : String(payload.id);
        if (id === null) return;
        const slot = slots.get(id);
        if (!slot) return; // never knew them; nothing to forget
        // The departure's server time gates future echoes. Fall back to the
        // newest position we ever heard, for a transport that (unlike ours)
        // stamps no time on removals.
        bury(id, Number.isFinite(payload.t) ? payload.t : (slot.buffer.newest()?.t ?? 0));
        slots.delete(id);
        return;
      }

      if (kind !== EVENT.ENTITY_UPSERT) return;
      const id = payload?.id == null ? null : String(payload.id);
      if (id === null || id === localId) return; // self-echo: prediction owns the local player
      if (!Number.isFinite(payload.x) || !Number.isFinite(payload.z)) return;
      if (!Number.isFinite(payload.t)) return; // untimed state cannot be buffered

      let slot = slots.get(id);
      if (!slot) {
        const buriedAt = tombstones.get(id);
        if (buriedAt != null && payload.t <= buriedAt) {
          // A delayed echo of a life the server already ended. Spawning from
          // it would resurrect a ghost no future REMOVE will ever clean up.
          staleDropped += 1;
          return;
        }
        if (slots.size >= maxActors) {
          refused += 1;
          return;
        }
        slot = { epoch: nextEpoch++, buffer: createSnapshotBuffer(), row: {} };
        slots.set(id, slot);
        tombstones.delete(id);
      }

      clock.observe(localNowMs, payload.t);
      slot.buffer.push({ t: payload.t, x: payload.x, z: payload.z, yaw: payload.yaw });
      // Keep the latest full row: hp/targetId feed nameplates and frames in
      // P10, and capturing it now costs one spread per snapshot.
      slot.row = payload;
    },

    /**
     * Where to draw everyone, at this local moment. Empty until the clock has
     * observed at least one arrival — no basis, no guesses.
     * @returns {{id: string, epoch: number, x: number, z: number, yaw: number, mode: string}[]}
     */
    sampleAll(localNowMs) {
      const renderTimeMs = clock.renderTimeAt(localNowMs);
      if (renderTimeMs == null) return [];
      const out = [];
      for (const [id, slot] of slots) {
        const s = slot.buffer.sample(renderTimeMs);
        if (s) out.push({ id, epoch: slot.epoch, x: s.x, z: s.z, yaw: s.yaw, mode: s.mode });
      }
      return out;
    },

    /** The latest authoritative row heard for a live actor (HUD surface). */
    rowOf: (id) => slots.get(String(id))?.row ?? null,

    count: () => slots.size,
    /** Spawns refused at the ceiling. Nonzero means the world is over budget. */
    refusedCount: () => refused,
    /** Post-departure echoes dropped. The ghost counter — should stay small. */
    staleDroppedCount: () => staleDropped,
    /** The shared clock, for diagnostics (delay/jitter readouts). */
    clock: () => clock,

    clear() {
      slots.clear();
      tombstones.clear();
    },
  };
}
