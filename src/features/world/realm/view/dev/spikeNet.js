/**
 * spikeNet — the P8 network demo, in its own module because spike.js has no
 * headroom (the same reason ActorCast exists).
 *
 * What it stands up, when URL params ask for it:
 *   - one shared localWorld — the in-process "server"
 *   - the LOCAL player as a real transport client: every sim tick's position
 *     goes through dispatch as a moveIntent, and RECONCILE corrections come
 *     back and are applied to the walker. This is the FIRST time the P1
 *     network stack drives the rendered world.
 *   - N ghost clients walking circles via their own moveIntents — real rows
 *     moved by the real rules, not scripted upserts, so what the demo shows
 *     is the same authority path P12's server will run.
 *   - a LatencyShapedTransport between the local client and the world, so
 *     everything you SEE of the world (ghosts, your own echoes, corrections)
 *     arrives late, jittered, reordered, and lossy on demand.
 *
 * URL params (all optional; the module is inert with none):
 *   ?remotes=3        ghost count (capped at the hub's runtime ceiling)
 *   &latency=80       base one-way latency, ms
 *   &jitter=60        one-sided jitter above that, ms
 *   &drop=0.05        snapshot loss rate [0, 1)
 *   &seed=17          the shaper's schedule seed
 *
 * The clock handed to EVERYTHING here is one function. The shaper computes
 * admission times on it, and LocalTransport computes movement dt on it at
 * delivery time — two clocks drifting apart hands a jitter-compressed intent a
 * 1 ms dt, a millimetre budget, and a manufactured RECONCILE that reads
 * exactly like an interpolator bug (moveRules' dt floor; see
 * LatencyShapedTransport's header).
 *
 * Deliberately free of BABYLON: this file orchestrates sim/ modules and hands
 * plain samples back; ActorCast is the layer that touches the engine.
 */

import { createLocalWorld } from '../../sim/transports/localWorld.js';
import { createLocalTransport } from '../../sim/transports/LocalTransport.js';
import { createLatencyShapedTransport } from '../../sim/transports/LatencyShapedTransport.js';
import { createRemoteActorHub } from '../../sim/remoteActorHub.js';
import { createDispatcher } from '../../sim/dispatch.js';
import { EVENT } from '../../sim/WorldTransport.js';
import { NET_TIMING } from '../../model/netTiming.js';

const LOCAL_ID = 'spike-player';

/** @returns {object|null} null when no param asks for the demo — fully inert. */
export function parseNetParams(search) {
  const q = new URLSearchParams(search);
  const num = (k) => {
    const v = Number(q.get(k));
    return Number.isFinite(v) && v >= 0 ? v : 0;
  };
  const params = {
    remotes: Math.floor(num('remotes')),
    latencyMs: num('latency'),
    jitterMs: num('jitter'),
    dropRate: Math.min(num('drop'), 0.95),
    seed: Math.floor(num('seed')) || 17,
  };
  const wanted = params.remotes > 0 || params.latencyMs > 0
    || params.jitterMs > 0 || params.dropRate > 0;
  return wanted ? params : null;
}

/**
 * @param {object} opts
 * @param {object} opts.params from parseNetParams — non-null
 * @param {() => number} opts.now the frame loop's clock (performance.now)
 * @param {(pos: {x:number, z:number, yaw:number}) => void} opts.onReconcile
 *   applied when the server overrules the local walker's claimed position.
 */
export async function createSpikeNet({ params, now, onReconcile }) {
  const world = createLocalWorld();

  // The local player's own link — the only shaped one. Ghost clients talk to
  // the world cleanly: it is YOUR connection that is bad, not the server's.
  const local = createLocalTransport({ now, world });
  const shaped = createLatencyShapedTransport(local, {
    now,
    latencyMs: params.latencyMs,
    jitterMs: params.jitterMs,
    dropRate: params.dropRate,
    seed: params.seed,
  });

  const hub = createRemoteActorHub({ localId: LOCAL_ID });
  shaped.subscribe((kind, payload) => {
    hub.ingest(kind, payload, now());
    // Corrections are addressed to this client alone and arrive through the
    // same shaped link as everything else — a lagged correction is realistic,
    // an instant one would be a lie the demo is built to not tell.
    if (kind === EVENT.RECONCILE) onReconcile?.(payload);
  });

  // The dispatcher numbers every command; the walker itself is the optimistic
  // prediction, so moveIntent needs no predict/undo — the event stream and
  // RECONCILE converge the store the moment the server disagrees.
  const dispatcher = createDispatcher({
    store: null,
    transport: shaped,
    commands: { moveIntent: {} },
  });

  await shaped.connect(LOCAL_ID);

  // ── Ghosts: real clients, circular walks ──────────────────────────────────
  const ghosts = [];
  for (let i = 0; i < params.remotes; i++) {
    const transport = createLocalTransport({ now, world });
    await transport.connect(`ghost-${i}`);
    ghosts.push({
      transport,
      seq: 0,
      // Spread around spawn, phase-offset so they never walk in lockstep.
      centerX: 6 + (i % 3) * 8,
      centerZ: -4 + Math.floor(i / 3) * 8,
      radiusM: 5 + (i % 2) * 3,
      speedMps: 3 + (i % 3), // 3-5 m/s, all under the 7 m/s cap
      // The walk angle is INTEGRATED, not computed from absolute time. An
      // absolute-time driver teleports after any stall (hidden tab, breakpoint,
      // frozen pane): the first tick after a 30 s freeze claims a position 30 s
      // of arc away, moveRules clamps it, and the demo spends the next minute
      // rubber-banding through catch-up — measured live at 262 m/s implied.
      // Integration with the stall clamp below means a stall PAUSES the
      // ghosts, exactly as the sim clock pauses the local walker.
      angle: (i * Math.PI * 2) / Math.max(params.remotes, 1),
    });
  }

  let lastSendMs = -Infinity;
  let lastGhostMs = -Infinity;

  return {
    hub,
    shaped,

    /**
     * Report the walker's position to the server, at the snapshot cadence
     * rather than per frame — 20 Hz is what P12's reducer budget expects, and
     * per-frame intents would just burn seq numbers for sub-centimetre deltas.
     */
    sendMove(walker, nowMs) {
      if (nowMs - lastSendMs < NET_TIMING.snapshotIntervalMs) return;
      lastSendMs = nowMs;
      dispatcher.dispatch('moveIntent', { x: walker.x, z: walker.z, yaw: walker.yaw });
    },

    /**
     * One call per rendered frame: advance the ghosts, release whatever the
     * link has decided to deliver, and hand back where every remote actor
     * should be drawn. The caller feeds the samples straight to
     * actorCast.syncRemotes().
     */
    update(nowMs) {
      if (nowMs - lastGhostMs >= NET_TIMING.snapshotIntervalMs) {
        // Stall clamp, same rationale as the sim clock's spiral guard: elapsed
        // time past a small budget is LOST, so a frozen pane resumes with the
        // ghosts one step on, not one lap on.
        const dtS = Math.min(nowMs - lastGhostMs, 250) / 1000;
        lastGhostMs = nowMs;
        for (const g of ghosts) {
          g.angle += (g.speedMps / g.radiusM) * dtS;
          const a = g.angle;
          // Forward = (sin yaw, cos yaw): yaw faces the velocity tangent.
          const vx = -Math.sin(a);
          const vz = Math.cos(a);
          g.transport.send('moveIntent', {
            x: g.centerX + g.radiusM * Math.cos(a),
            z: g.centerZ + g.radiusM * Math.sin(a),
            yaw: Math.atan2(vx, vz),
          }, ++g.seq);
        }
      }
      shaped.pump(nowMs);
      return hub.sampleAll(nowMs);
    },

    /** One diag line: population, link quality, and the two failure counters. */
    statsLine() {
      const clock = hub.clock();
      return `${hub.count()} remote(s) · delay ${clock.delayMs().toFixed(0)}ms `
        + `· jitter ${clock.jitterMs().toFixed(0)}ms · pending ${shaped.pendingCount()} `
        + `· dropped ${shaped.droppedCount()} · refused ${hub.refusedCount()} `
        + `· stale ${hub.staleDroppedCount()}`;
    },

    dispose() {
      for (const g of ghosts) g.transport.dispose();
      shaped.dispose();
      local.dispose();
      hub.clear();
    },
  };
}
