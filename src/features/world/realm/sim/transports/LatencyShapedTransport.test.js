import { describe, expect, it } from 'vitest';
import { EVENT } from '../WorldTransport.js';
import { createLocalTransport } from './LocalTransport.js';
import { createPlaybackTransport } from './PlaybackTransport.js';
import { createLatencyShapedTransport, LINK_PROFILES } from './LatencyShapedTransport.js';
import { transportConformanceCases } from './transportConformance.js';

/** A script of N upserts all stamped at the same instant, distinguishable by x. */
const burst = (n, atMs = 0) => Array.from({ length: n }, (_, i) => ({
  atMs,
  kind: EVENT.ENTITY_UPSERT,
  payload: { id: 'r1', t: atMs, x: i, z: 0, yaw: 0 },
}));

function rig({ script = [], ...shape } = {}) {
  let t = 0;
  const now = () => t;
  const inner = createPlaybackTransport({ now, script });
  const shaped = createLatencyShapedTransport(inner, { now, ...shape });
  const seen = [];
  shaped.subscribe((kind, payload) => seen.push({ kind, payload }));
  return {
    seen,
    shaped,
    inner,
    at(ms) { t = ms; inner.pump(ms); return shaped.pump(ms); },
  };
}

describe('LatencyShapedTransport conformance', () => {
  for (const c of transportConformanceCases(() => {
    let t = 0;
    const now = () => t;
    const inner = createLocalTransport({ now });
    const shaped = createLatencyShapedTransport(inner, {
      now, latencyMs: 40, jitterMs: 25, seed: 3,
    });
    return {
      transport: shaped,
      okCommand: { name: 'moveIntent', payload: { x: 0.1, z: 0 } },
      settle: () => shaped.settle(),
    };
  })) {
    it(c.name, async () => { await c.run(expect); });
  }
});

describe('createLatencyShapedTransport', () => {
  it('refuses to build without a clock', () => {
    // The clock must be the wrapped transport's own. A shaper that quietly
    // defaulted to Date.now() would compute admission times on one timeline
    // while LocalTransport computed movement dt on another — and the resulting
    // rubber-banding looks exactly like an interpolator bug.
    const inner = createPlaybackTransport({ now: () => 0 });
    expect(() => createLatencyShapedTransport(inner, {})).toThrow(/now/);
  });

  it('rejects negative latency or jitter', () => {
    const inner = createPlaybackTransport({ now: () => 0 });
    expect(() => createLatencyShapedTransport(inner, { now: () => 0, latencyMs: -1 }))
      .toThrow(/non-negative/);
  });

  it('holds an event back until its latency has elapsed', async () => {
    const r = rig({ script: burst(1), latencyMs: 50 });
    await r.shaped.connect('me');
    r.at(0);
    expect(r.seen.filter((e) => e.kind === EVENT.ENTITY_UPSERT)).toHaveLength(0);
    r.at(49);
    expect(r.seen.filter((e) => e.kind === EVENT.ENTITY_UPSERT)).toHaveLength(0);
    r.at(50);
    expect(r.seen.filter((e) => e.kind === EVENT.ENTITY_UPSERT)).toHaveLength(1);
  });

  it('reorders events when jitter overtakes them', async () => {
    // THE property the exit bar depends on. Reordering is not simulated
    // separately — it falls out of per-event jitter, exactly as on a real link.
    const r = rig({ script: burst(12), latencyMs: 20, jitterMs: 200, seed: 11 });
    await r.shaped.connect('me');
    r.at(0);
    r.shaped.settle();

    const order = r.seen
      .filter((e) => e.kind === EVENT.ENTITY_UPSERT)
      .map((e) => e.payload.x);
    expect(order).toHaveLength(12);
    expect(order, 'jitter produced no reordering at all').not.toEqual(
      [...order].sort((a, b) => a - b),
    );
  });

  it('produces the same order for the same seed', async () => {
    // Reproducibility is the whole point: a failing gate has to be re-runnable.
    const run = async () => {
      const r = rig({ script: burst(10), latencyMs: 20, jitterMs: 150, seed: 5 });
      await r.shaped.connect('me');
      r.at(0);
      r.shaped.settle();
      return r.seen.filter((e) => e.kind === EVENT.ENTITY_UPSERT).map((e) => e.payload.x);
    };
    expect(await run()).toEqual(await run());
  });

  it('produces a different order for a different seed', async () => {
    const run = async (seed) => {
      const r = rig({ script: burst(10), latencyMs: 20, jitterMs: 150, seed });
      await r.shaped.connect('me');
      r.at(0);
      r.shaped.settle();
      return r.seen.filter((e) => e.kind === EVENT.ENTITY_UPSERT).map((e) => e.payload.x);
    };
    expect(await run(5)).not.toEqual(await run(9999));
  });

  it('never delivers an event before its base latency', async () => {
    // Jitter is one-sided. Two-sided jitter would let a packet arrive earlier
    // than physically possible, which no link does and no client should tolerate.
    const r = rig({ script: burst(20), latencyMs: 100, jitterMs: 300, seed: 2 });
    await r.shaped.connect('me');
    r.at(0);
    r.at(99);
    expect(r.seen.filter((e) => e.kind === EVENT.ENTITY_UPSERT)).toHaveLength(0);
  });

  it('drops state snapshots but never connection or correction events', async () => {
    // Losing an ENTITY_UPSERT is what packet loss looks like, and surviving it
    // is the buffer's job. Losing a CONNECTION would desync the client's own
    // notion of being online — not a thing the interpolator can absorb.
    const r = rig({ script: burst(200), latencyMs: 5, dropRate: 0.5, seed: 4 });
    await r.shaped.connect('me');
    r.at(0);
    r.shaped.settle();

    const delivered = r.seen.filter((e) => e.kind === EVENT.ENTITY_UPSERT).length;
    expect(delivered).toBeGreaterThan(50);
    expect(delivered).toBeLessThan(150);
    expect(r.shaped.droppedCount()).toBe(200 - delivered);
    // The connect notice survived a 50% loss rate.
    expect(r.seen.some((e) => e.kind === EVENT.CONNECTION)).toBe(true);
  });

  it('drops nothing at a zero drop rate', async () => {
    const r = rig({ script: burst(50), latencyMs: 5, dropRate: 0, seed: 4 });
    await r.shaped.connect('me');
    r.at(0);
    r.shaped.settle();
    expect(r.shaped.droppedCount()).toBe(0);
    expect(r.seen.filter((e) => e.kind === EVENT.ENTITY_UPSERT)).toHaveLength(50);
  });

  it('passes commands straight through, undelayed', async () => {
    // Outbound shaping is deliberately out of scope: a delayed send() would
    // leave its promise unresolved until something pumped, deadlocking every
    // caller that awaits a command — which dispatch does.
    let t = 0;
    const now = () => t;
    const inner = createLocalTransport({ now });
    const shaped = createLatencyShapedTransport(inner, { now, latencyMs: 500 });
    await shaped.connect('p1');
    const r = await shaped.send('moveIntent', { x: 0.1, z: 0 }, 1);
    expect(r.ok).toBe(true);
  });

  it('stops delivering after dispose', async () => {
    const r = rig({ script: burst(3), latencyMs: 1 });
    await r.shaped.connect('me');
    r.at(0);
    r.shaped.dispose();
    r.at(100);
    expect(r.seen.filter((e) => e.kind === EVENT.ENTITY_UPSERT)).toHaveLength(0);
  });

  it('offers link profiles whose loss rates stay in range', () => {
    for (const [name, p] of Object.entries(LINK_PROFILES)) {
      expect(p.latencyMs, name).toBeGreaterThanOrEqual(0);
      expect(p.dropRate, name).toBeGreaterThanOrEqual(0);
      expect(p.dropRate, name).toBeLessThan(1);
    }
  });
});
