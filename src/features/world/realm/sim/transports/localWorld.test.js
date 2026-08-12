import { describe, expect, it } from 'vitest';
import { EVENT } from '../WorldTransport.js';
import { createLocalWorld } from './localWorld.js';
import { createLocalTransport } from './LocalTransport.js';
import { transportConformanceCases } from './transportConformance.js';

const listen = (t) => {
  const seen = [];
  t.subscribe((kind, payload) => seen.push({ kind, payload }));
  return seen;
};
const upserts = (seen) => seen.filter((e) => e.kind === EVENT.ENTITY_UPSERT);

describe('LocalTransport conformance', () => {
  for (const c of transportConformanceCases(() => ({
    transport: createLocalTransport({ now: () => 0 }),
    okCommand: { name: 'moveIntent', payload: { x: 0.1, z: 0 } },
  }))) {
    it(c.name, async () => { await c.run(expect); });
  }
});

describe('a shared world', () => {
  it('keeps separate transports isolated when no world is passed', () => {
    // The P1–P7 default. Changing it would silently join every existing
    // single-client test into one world.
    const a = createLocalTransport({ now: () => 0 });
    const b = createLocalTransport({ now: () => 0 });
    expect(a._world).not.toBe(b._world);
  });

  it('lets two clients see each other move', async () => {
    // The capability P8 exists for, and the one nothing before it had: two
    // transports were two disjoint universes, so no arrangement of them could
    // produce a remote player at all.
    const world = createLocalWorld();
    const now = () => 0;
    const a = createLocalTransport({ now, world });
    const b = createLocalTransport({ now, world });
    await a.connect('pa');
    await b.connect('pb');

    const seenByB = listen(b);
    await a.send('moveIntent', { x: 1, z: 0 }, 1);

    const fromA = upserts(seenByB).filter((e) => e.payload.id === 'pa');
    expect(fromA.length).toBe(1);
    expect(fromA[0].payload).toMatchObject({ x: 1, z: 0 });
  });

  it('tells a joiner about occupants who are already standing there', async () => {
    // Without the initial sync a stationary occupant is invisible until they
    // next move — which reads as "remote players are broken", not as a missing
    // sync, and would be chased in the interpolator.
    const world = createLocalWorld();
    const now = () => 0;
    const a = createLocalTransport({ now, world });
    await a.connect('pa');

    const b = createLocalTransport({ now, world });
    const seenByB = listen(b);
    await b.connect('pb');

    expect(upserts(seenByB).map((e) => e.payload.id)).toContain('pa');
  });

  it('tells existing clients about a joiner', async () => {
    const world = createLocalWorld();
    const now = () => 0;
    const a = createLocalTransport({ now, world });
    await a.connect('pa');

    const seenByA = listen(a);
    const b = createLocalTransport({ now, world });
    await b.connect('pb');

    expect(upserts(seenByA).map((e) => e.payload.id)).toContain('pb');
  });

  it('broadcasts ENTITY_REMOVE when a client leaves', async () => {
    // Defined since P1, emitted by nothing until now. A hub that never receives
    // it leaks one actor — and one scene-registered skeleton — per departure.
    const world = createLocalWorld();
    const now = () => 0;
    const a = createLocalTransport({ now, world });
    const b = createLocalTransport({ now, world });
    await a.connect('pa');
    await b.connect('pb');

    const seenByB = listen(b);
    await a.disconnect();

    const removal = seenByB.find((e) => e.kind === EVENT.ENTITY_REMOVE);
    expect(removal, 'no ENTITY_REMOVE reached the other client').toBeTruthy();
    expect(removal.payload.id).toBe('pa');
  });

  it('addresses a correction to the mover alone', async () => {
    // RECONCILE is a correction for one client's prediction. Broadcasting it
    // would order every other client to move to that position too.
    const world = createLocalWorld();
    const now = () => 0;
    const a = createLocalTransport({ now, world });
    const b = createLocalTransport({ now, world });
    await a.connect('pa');
    await b.connect('pb');

    const seenByA = listen(a);
    const seenByB = listen(b);
    await a.send('moveIntent', { x: 500, z: 500 }, 1); // far past any budget

    expect(seenByA.some((e) => e.kind === EVENT.RECONCILE)).toBe(true);
    expect(seenByB.some((e) => e.kind === EVENT.RECONCILE)).toBe(false);
  });

  it('does not broadcast one client’s CONNECTION to another', async () => {
    const world = createLocalWorld();
    const now = () => 0;
    const a = createLocalTransport({ now, world });
    await a.connect('pa');

    const seenByA = listen(a);
    const b = createLocalTransport({ now, world });
    await b.connect('pb');

    expect(seenByA.some((e) => e.kind === EVENT.CONNECTION)).toBe(false);
  });

  it('does not resurrect a leaver as a ghost for a later joiner', async () => {
    // THE presence hole from review: disconnect broadcast ENTITY_REMOVE but the
    // authoritative row stayed in the db, so a later joiner's initial sync
    // upserted the departed player back into existence — a ghost actor no
    // REMOVE would ever clean up, standing at their last position forever.
    const world = createLocalWorld();
    const now = () => 0;
    const a = createLocalTransport({ now, world });
    await a.connect('pa');
    await a.disconnect();

    const b = createLocalTransport({ now, world });
    const seenByB = listen(b);
    await b.connect('pb');

    expect(upserts(seenByB).map((e) => e.payload.id)).not.toContain('pa');
  });

  it('re-announces a returning player to later joiners', async () => {
    // The other half of presence: marking the leaver must not be permanent.
    // Reconnect keeps the row (lastMoveAtMs resume semantics are P1 behaviour),
    // so coming back has to flip them visible again.
    const world = createLocalWorld();
    const now = () => 0;
    const a = createLocalTransport({ now, world });
    await a.connect('pa');
    await a.disconnect();
    await a.connect('pa');

    const b = createLocalTransport({ now, world });
    const seenByB = listen(b);
    await b.connect('pb');

    expect(upserts(seenByB).map((e) => e.payload.id)).toContain('pa');
  });

  it('treats dispose while connected as a departure', async () => {
    // dispose() is how a churning demo tears a client down. Detaching without
    // announcing the departure leaves every peer holding a live actor — and a
    // scene-registered skeleton — that nothing will ever remove.
    const world = createLocalWorld();
    const now = () => 0;
    const a = createLocalTransport({ now, world });
    const b = createLocalTransport({ now, world });
    await a.connect('pa');
    await b.connect('pb');

    const seenByB = listen(b);
    a.dispose();

    const removal = seenByB.find((e) => e.kind === EVENT.ENTITY_REMOVE);
    expect(removal, 'dispose of a connected transport announced nothing').toBeTruthy();
    expect(removal.payload.id).toBe('pa');
  });

  it('announces a departure exactly once across disconnect then dispose', async () => {
    const world = createLocalWorld();
    const now = () => 0;
    const a = createLocalTransport({ now, world });
    const b = createLocalTransport({ now, world });
    await a.connect('pa');
    await b.connect('pb');

    const seenByB = listen(b);
    await a.disconnect();
    await a.disconnect(); // idempotent
    a.dispose();

    expect(seenByB.filter((e) => e.kind === EVENT.ENTITY_REMOVE)).toHaveLength(1);
  });

  it('keeps presence bookkeeping off the wire', async () => {
    // Same rule as lastMoveAtMs: server-internal fields never reach clients.
    const world = createLocalWorld();
    const now = () => 0;
    const a = createLocalTransport({ now, world });
    await a.connect('pa');
    const seenByA = listen(a);
    await a.send('moveIntent', { x: 1, z: 0 }, 1);
    expect(upserts(seenByA)[0].payload).not.toHaveProperty('online');
  });

  it('stops delivering to a disposed transport', async () => {
    const world = createLocalWorld();
    const now = () => 0;
    const a = createLocalTransport({ now, world });
    const b = createLocalTransport({ now, world });
    await a.connect('pa');
    await b.connect('pb');

    const seenByB = listen(b);
    b.dispose();
    await a.send('moveIntent', { x: 1, z: 0 }, 1);

    expect(seenByB).toEqual([]);
    expect(world.portCount()).toBe(1);
  });
});

describe('the wire', () => {
  it('stamps every upsert with the server time the state was true', async () => {
    // The interpolation buffer keys on this. Without it a client can only order
    // snapshots by arrival, which under jitter is the exact noise interpolation
    // exists to remove.
    let t = 0;
    const transport = createLocalTransport({ now: () => t });
    await transport.connect('p1');
    const seen = listen(transport);

    t = 1234;
    await transport.send('moveIntent', { x: 1, z: 0 }, 5);
    expect(upserts(seen)[0].payload.t).toBe(1234);
  });

  it('names the command an upsert came from, so a client can spot its own echo', async () => {
    let t = 0;
    const transport = createLocalTransport({ now: () => t });
    await transport.connect('p1');
    const seen = listen(transport);

    await transport.send('moveIntent', { x: 1, z: 0 }, 42);
    expect(upserts(seen)[0].payload.originSeq).toBe(42);
  });

  it('leaves originSeq null when nothing commanded the change', async () => {
    const transport = createLocalTransport({ now: () => 0 });
    const seen = listen(transport);
    await transport.connect('p1');
    expect(upserts(seen)[0].payload.originSeq).toBeNull();
  });

  it('still keeps server-internal move timing off the wire', async () => {
    // The P1 rule, re-asserted because playerView was rewritten in P8.
    const transport = createLocalTransport({ now: () => 7 });
    await transport.connect('p1');
    const seen = listen(transport);
    await transport.send('moveIntent', { x: 1, z: 0 }, 1);
    expect(upserts(seen)[0].payload).not.toHaveProperty('lastMoveAtMs');
  });
});
