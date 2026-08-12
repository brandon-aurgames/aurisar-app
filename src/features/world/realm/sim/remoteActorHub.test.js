import { describe, expect, it } from 'vitest';
import { EVENT } from './WorldTransport.js';
import { createRemoteActorHub } from './remoteActorHub.js';
import { createLocalTransport } from './transports/LocalTransport.js';
import { createLocalWorld } from './transports/localWorld.js';
import { createLatencyShapedTransport } from './transports/LatencyShapedTransport.js';
import { ACTOR_CEILINGS } from '../model/actorBudget.js';
import { NET_TIMING } from '../model/netTiming.js';

const up = (id, t, x = 0, z = 0, yaw = 0) => [EVENT.ENTITY_UPSERT, { id, t, x, z, yaw }];
const rm = (id, t) => [EVENT.ENTITY_REMOVE, { id, t }];

/** Feed enough on-cadence snapshots that the playout clock has a real basis. */
function warm(hub, id, { fromT = 0, n = 10, localLagMs = 0 } = {}) {
  for (let i = 0; i < n; i++) {
    const t = fromT + i * NET_TIMING.snapshotIntervalMs;
    hub.ingest(...up(id, t, i, 0), t + localLagMs);
  }
  return fromT + (n - 1) * NET_TIMING.snapshotIntervalMs;
}

describe('createRemoteActorHub', () => {
  it('spawns an actor on its first snapshot and samples it', () => {
    const hub = createRemoteActorHub();
    const lastT = warm(hub, 'r1');
    expect(hub.count()).toBe(1);
    const samples = hub.sampleAll(lastT);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ id: 'r1', epoch: 1 });
    expect(Number.isFinite(samples[0].x)).toBe(true);
  });

  it('never spawns the local player from its own echo', () => {
    // The local player is prediction-driven; a hub that also spawned a remote
    // rig for it would draw the player twice, the copy lagging by the
    // interpolation delay.
    const hub = createRemoteActorHub({ localId: 'me' });
    warm(hub, 'me');
    expect(hub.count()).toBe(0);
  });

  it('drops removed actors and reports them gone', () => {
    const hub = createRemoteActorHub();
    const lastT = warm(hub, 'r1');
    hub.ingest(...rm('r1', lastT + 1), lastT + 1);
    expect(hub.count()).toBe(0);
    expect(hub.sampleAll(lastT + 10)).toEqual([]);
  });

  it('refuses a post-removal echo instead of resurrecting a ghost', () => {
    // THE ingestion gate. Under jitter, an UPSERT can be delivered after the
    // REMOVE that outranks it; treating any unknown id as a fresh spawn would
    // resurrect the departed actor — permanently, because the server already
    // said REMOVE and will never say it again.
    const hub = createRemoteActorHub();
    const lastT = warm(hub, 'r1');
    hub.ingest(...rm('r1', lastT + 10), lastT + 10);

    // The delayed echo: stamped BEFORE the departure, delivered after it.
    hub.ingest(...up('r1', lastT + 5, 99, 99), lastT + 60);
    expect(hub.count()).toBe(0);
    expect(hub.staleDroppedCount()).toBe(1);
  });

  it('a REMOVE for a never-known id still buries it — reorder cannot resurrect', () => {
    // Review finding: the shaped link reorders by construction, so a REMOVE
    // can be delivered BEFORE any UPSERT for that id ever arrives. Ignoring
    // it with "never knew them, nothing to forget" leaves no tombstone, and
    // the late UPSERT (stamped before the departure) spawns a permanent ghost
    // — the server already said REMOVE and will never say it again.
    const hub = createRemoteActorHub();
    hub.ingest(...rm('x', 100), 0);
    hub.ingest(...up('x', 50, 9, 9), 60); // the reordered, pre-departure echo
    expect(hub.count()).toBe(0);
    expect(hub.staleDroppedCount()).toBe(1);
  });

  it('a REMOVE-first burial still admits a genuinely newer spawn', () => {
    // The tombstone must gate on time, not on the id forever: the same player
    // really can join after the client heard their (reordered) departure.
    const hub = createRemoteActorHub();
    hub.ingest(...rm('x', 100), 0);
    warm(hub, 'x', { fromT: 200 });
    expect(hub.count()).toBe(1);
  });

  it('a ceiling-refused actor cannot slip in as a stale echo after departing', () => {
    // The compound case from review: an actor refused at the ceiling never
    // entered slots; the server later REMOVEs them (unknown-id REMOVE here);
    // another departure frees a slot; then their delayed pre-departure UPSERT
    // arrives. Without the unknown-id burial it would spawn a ghost into the
    // freed slot.
    const hub = createRemoteActorHub({ maxActors: 1 });
    warm(hub, 'a', { n: 2 });                 // fills the only slot
    hub.ingest(...up('b', 100, 1, 1), 100);   // refused at ceiling
    expect(hub.refusedCount()).toBe(1);
    hub.ingest(...rm('b', 150), 150);         // b departs, still unknown here
    hub.ingest(...rm('a', 200), 200);         // a departs — slot frees
    hub.ingest(...up('b', 120, 2, 2), 250);   // b's stale echo, pre-departure
    expect(hub.count()).toBe(0);
    expect(hub.staleDroppedCount()).toBe(1);
  });

  it('two reordered REMOVEs keep the NEWER departure time', () => {
    // bury() must take max: a stale REMOVE delivered after a fresh one must
    // not narrow the gate and re-admit echoes between the two stamps.
    const hub = createRemoteActorHub();
    hub.ingest(...rm('x', 500), 0);
    hub.ingest(...rm('x', 100), 10); // older departure, delivered later
    hub.ingest(...up('x', 300, 1, 1), 20); // between the stamps — still stale
    expect(hub.count()).toBe(0);
  });

  it('accepts a genuine respawn as a NEW actor with a new epoch', () => {
    // Same id, later server time than the departure: the server really did
    // spawn them again. The fresh epoch is what lets the view key rigs by
    // id#epoch, so the old rig can never be reused for the new life.
    const hub = createRemoteActorHub();
    const lastT = warm(hub, 'r1');
    hub.ingest(...rm('r1', lastT + 10), lastT + 10);
    warm(hub, 'r1', { fromT: lastT + 20 });

    expect(hub.count()).toBe(1);
    const [s] = hub.sampleAll(lastT + 20 + 9 * NET_TIMING.snapshotIntervalMs);
    expect(s.epoch).toBe(2);
  });

  it('enforces the actor ceiling at runtime — the first code ever to', () => {
    // actorBudget.js has said since P6 that "NOTHING AT RUNTIME READS EITHER
    // NUMBER" and assigned enforcement to whichever phase first spawns actors
    // dynamically. This assertion is that phase honouring the assignment.
    const hub = createRemoteActorHub({ maxActors: 3 });
    // One snapshot per candidate: the counter counts refused EVENTS (every
    // snapshot that would have spawned), so one attempt each keeps refused ==
    // refused actors and the assertion unambiguous.
    for (let i = 0; i < 5; i++) warm(hub, `r${i}`, { n: 1 });
    expect(hub.count()).toBe(3);
    expect(hub.refusedCount()).toBe(2);
  });

  it('defaults the ceiling to the budget number MINUS the local player', () => {
    // The ceiling prices ACTORS; the local player is one, drawn outside the
    // hub. A default of the full 24 would put 25 rigs on screen and quietly
    // overrun the invoice realmActorBudget.test.js spends.
    const hub = createRemoteActorHub();
    for (let i = 0; i < ACTOR_CEILINGS.maxSimultaneousActors + 4; i++) {
      warm(hub, `r${i}`, { n: 1 });
    }
    expect(hub.count()).toBe(ACTOR_CEILINGS.maxSimultaneousActors - 1);
    expect(hub.refusedCount()).toBe(5);
  });

  it('frees ceiling room when an actor departs', () => {
    const hub = createRemoteActorHub({ maxActors: 2 });
    warm(hub, 'a', { n: 2 });
    warm(hub, 'b', { fromT: 5, n: 2 });
    hub.ingest(...rm('a', 10_000), 10_000);
    warm(hub, 'c', { fromT: 10_001, n: 2 });
    expect(hub.count()).toBe(2);
  });

  it('ignores snapshots with no time base rather than corrupting a buffer', () => {
    const hub = createRemoteActorHub();
    hub.ingest(EVENT.ENTITY_UPSERT, { id: 'r1', x: 1, z: 1 }, 100); // no t
    hub.ingest(EVENT.ENTITY_UPSERT, { id: 'r1', t: Number.NaN, x: 1, z: 1 }, 100);
    expect(hub.count()).toBe(0);
  });

  it('ignores kinds that belong to the local pipeline', () => {
    const hub = createRemoteActorHub();
    hub.ingest(EVENT.RECONCILE, { seq: 1, x: 0, z: 0, yaw: 0 }, 100);
    hub.ingest(EVENT.CONNECTION, { connected: true }, 100);
    expect(hub.count()).toBe(0);
  });

  it('keeps the latest authoritative row for HUD surfaces', () => {
    const hub = createRemoteActorHub();
    hub.ingest(EVENT.ENTITY_UPSERT, { id: 'r1', t: 0, x: 0, z: 0, yaw: 0, hp: 100 }, 0);
    hub.ingest(EVENT.ENTITY_UPSERT, { id: 'r1', t: 50, x: 1, z: 0, yaw: 0, hp: 73 }, 50);
    expect(hub.rowOf('r1').hp).toBe(73);
  });
});

describe('hub against the real transport stack', () => {
  it('sees another client join, move, and leave — through a jittered link', async () => {
    // The first end-to-end proof with no scripted oracle: a REAL second client
    // on a shared world, moving via moveIntent through the REAL rules, heard
    // through the REAL latency shaper, landing in the hub as a smoothly
    // sampleable remote actor. This is the exact stack the spike demo runs.
    let t = 0;
    const now = () => t;
    const world = createLocalWorld();

    const mine = createLocalTransport({ now, world });
    const shaped = createLatencyShapedTransport(mine, {
      now, latencyMs: 60, jitterMs: 40, seed: 7,
    });
    const hub = createRemoteActorHub({ localId: 'me' });
    shaped.subscribe((kind, payload) => hub.ingest(kind, payload, t));
    await shaped.connect('me');

    const ghost = createLocalTransport({ now, world });
    await ghost.connect('ghost');

    // The ghost walks east at 4 m/s, one intent per snapshot interval.
    let seq = 0;
    for (let step = 1; step <= 40; step++) {
      t = step * NET_TIMING.snapshotIntervalMs;
      const x = 4 * (t / 1000);
      await ghost.send('moveIntent', { x, z: 0, yaw: Math.PI / 2 }, ++seq);
      shaped.pump(t);
    }

    expect(hub.count()).toBe(1);
    const [s] = hub.sampleAll(t);
    expect(s.id).toBe('ghost');
    // Sampled in the delayed past, so behind the ghost's true position but
    // strictly inside the path it has walked — never extrapolated past it.
    expect(s.x).toBeGreaterThan(0);
    expect(s.x).toBeLessThan(4 * (t / 1000));

    // Departure survives the jittered link too.
    await ghost.disconnect();
    shaped.settle();
    expect(hub.count()).toBe(0);
  });

  it('local echoes through the shaper never become a second self', async () => {
    let t = 0;
    const now = () => t;
    const world = createLocalWorld();
    const mine = createLocalTransport({ now, world });
    const shaped = createLatencyShapedTransport(mine, { now, latencyMs: 50, seed: 3 });
    const hub = createRemoteActorHub({ localId: 'me' });
    shaped.subscribe((kind, payload) => hub.ingest(kind, payload, t));
    await shaped.connect('me');

    for (let step = 1; step <= 10; step++) {
      t = step * 50;
      await shaped.send('moveIntent', { x: step * 0.2, z: 0 }, step);
      shaped.pump(t);
    }
    expect(hub.count()).toBe(0);
  });
});
