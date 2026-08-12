import { describe, expect, it } from 'vitest';
import { EVENT } from '../WorldTransport.js';
import {
  circleTruthAt,
  createPlaybackTransport,
  scriptCircle,
} from './PlaybackTransport.js';
import { transportConformanceCases } from './transportConformance.js';
import { NET_TIMING } from '../../model/netTiming.js';

describe('PlaybackTransport conformance', () => {
  for (const c of transportConformanceCases(() => {
    // A short real script, so the wire-shape case has upserts to inspect
    // rather than passing vacuously on an empty stream.
    const transport = createPlaybackTransport({
      now: () => 0,
      script: scriptCircle({ durationMs: 100 }),
    });
    return {
      transport,
      okCommand: { name: 'noop', payload: {} },
      settle: () => transport.settle(),
    };
  })) {
    it(c.name, async () => { await c.run(expect); });
  }
});

describe('createPlaybackTransport', () => {
  it('requires a clock', () => {
    expect(() => createPlaybackTransport({})).toThrow(/now/);
  });

  it('emits only what is due', async () => {
    const script = [
      { atMs: 0, kind: EVENT.ENTITY_UPSERT, payload: { id: 'r', t: 0, x: 0, z: 0 } },
      { atMs: 100, kind: EVENT.ENTITY_UPSERT, payload: { id: 'r', t: 100, x: 1, z: 0 } },
      { atMs: 200, kind: EVENT.ENTITY_UPSERT, payload: { id: 'r', t: 200, x: 2, z: 0 } },
    ];
    const transport = createPlaybackTransport({ now: () => 0, script });
    const seen = [];
    transport.subscribe((kind, payload) => {
      if (kind === EVENT.ENTITY_UPSERT) seen.push(payload);
    });
    await transport.connect('me');

    expect(transport.pump(0)).toBe(1);
    expect(transport.pump(99)).toBe(0);
    expect(transport.pump(150)).toBe(1);
    expect(transport.pump(10_000)).toBe(1);
    expect(seen.map((p) => p.x)).toEqual([0, 1, 2]);
    expect(transport.remainingCount()).toBe(0);
  });

  it('sorts a script handed to it out of order', async () => {
    const mk = (atMs, x) => ({ atMs, kind: EVENT.ENTITY_UPSERT, payload: { id: 'r', t: atMs, x, z: 0 } });
    const transport = createPlaybackTransport({ now: () => 0, script: [mk(200, 2), mk(0, 0), mk(100, 1)] });
    const seen = [];
    transport.subscribe((kind, p) => {
      if (kind === EVENT.ENTITY_UPSERT) seen.push(p.x);
    });
    await transport.connect('me');
    transport.settle();
    expect(seen).toEqual([0, 1, 2]);
  });
});

describe('scriptCircle', () => {
  it('emits at the configured cadence', () => {
    const s = scriptCircle({ durationMs: 1000, hz: 20 });
    expect(s).toHaveLength(21); // inclusive of both ends
    expect(s[1].atMs - s[0].atMs).toBeCloseTo(50, 9);
  });

  it('walks at the requested speed', () => {
    // If the fixture moved faster than the server would ever permit, the
    // interpolator's teleport guard would classify every step as a jump and the
    // gate would pass while testing the snap path instead of interpolation.
    const speedMps = 4.2;
    const s = scriptCircle({ durationMs: 2000, speedMps, radiusM: 8 });
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1].payload;
      const b = s[i].payload;
      const chord = Math.hypot(b.x - a.x, b.z - a.z);
      const impliedMps = chord / ((b.t - a.t) / 1000);
      // Chord slightly undercuts the arc; 2% covers it at this cadence.
      expect(impliedMps).toBeGreaterThan(speedMps * 0.95);
      expect(impliedMps).toBeLessThan(speedMps * 1.02);
    }
  });

  it('stays under the teleport threshold at every step', () => {
    const s = scriptCircle({ durationMs: 4000 });
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1].payload;
      const b = s[i].payload;
      const mps = Math.hypot(b.x - a.x, b.z - a.z) / ((b.t - a.t) / 1000);
      expect(mps).toBeLessThan(NET_TIMING.teleportSpeedMps);
    }
  });

  it('sweeps yaw across the +-pi seam', () => {
    // Why the fixture is a circle and not a straight line: a full revolution
    // guarantees the wrap is exercised by the same track that checks position,
    // so an interpolator lerping angles the long way round cannot hide.
    const s = scriptCircle({ durationMs: 20_000, radiusM: 4, speedMps: 4.2 });
    const yaws = s.map((e) => e.payload.yaw);
    const crossings = yaws.slice(1).filter((y, i) => Math.abs(y - yaws[i]) > Math.PI);
    expect(crossings.length).toBeGreaterThan(0);
  });

  it('keeps every yaw in atan2 range', () => {
    const s = scriptCircle({ durationMs: 20_000 });
    for (const e of s) {
      expect(e.payload.yaw).toBeGreaterThanOrEqual(-Math.PI);
      expect(e.payload.yaw).toBeLessThanOrEqual(Math.PI);
    }
  });

  it('rejects a zero radius rather than emitting NaN', () => {
    expect(() => scriptCircle({ radiusM: 0 })).toThrow(/radius/);
  });
});

describe('circleTruthAt', () => {
  it('agrees with the script at every scripted instant', () => {
    // The oracle and the script must describe one path. If they drifted, the
    // gate would measure the interpolator against the wrong truth and either
    // fail honest code or pass broken code.
    const opts = { startMs: 0, radiusM: 8, speedMps: 4.2 };
    const s = scriptCircle({ ...opts, durationMs: 3000 });
    for (const e of s) {
      const truth = circleTruthAt(e.payload.t, opts);
      expect(truth.x).toBeCloseTo(e.payload.x, 9);
      expect(truth.z).toBeCloseTo(e.payload.z, 9);
    }
  });

  it('describes a continuous path between scripted instants', () => {
    const opts = { startMs: 0, radiusM: 8, speedMps: 4.2 };
    const a = circleTruthAt(1000, opts);
    const b = circleTruthAt(1001, opts);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.01);
  });
});
