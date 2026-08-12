import { describe, expect, it } from 'vitest';
import {
  INTERP_MODE,
  createSnapshotBuffer,
  lerpAngle,
  sampleSnapshots,
} from './interpolate.js';
import { NET_TIMING } from '../model/netTiming.js';

const snap = (t, x, z, yaw = 0) => ({ t, x, z, yaw });

/**
 * Fixtures below use one-second spans for readable round distances. That is not
 * cosmetic: at the real 50 ms cadence a "10 m" step implies 200 m/s, which the
 * teleport guard correctly classifies as a jump rather than motion — so a
 * fixture written for legibility would silently test the snap path while
 * claiming to test interpolation. Spans here are chosen to stay under
 * NET_TIMING.teleportSpeedMps.
 */

describe('lerpAngle', () => {
  it('blends linearly well away from the seam', () => {
    expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4, 12);
  });

  it('takes the short way across the +-pi seam', () => {
    // THE bug this function exists for. Yaw arrives as atan2 output in
    // (-pi, pi], so a player turning through south hands us (3.10, -3.10): a
    // plain lerp travels 6.2 radians the wrong way round while the actor was
    // physically turning 0.08. Halfway must land at the seam, not at zero.
    const mid = lerpAngle(3.10, -3.10, 0.5);
    expect(Math.abs(mid)).toBeCloseTo(Math.PI, 2);
    // Specifically NOT the long-way answer, which would pass through 0.
    expect(Math.abs(mid)).toBeGreaterThan(3);
  });

  it('is symmetric across the seam in both directions', () => {
    expect(lerpAngle(-3.10, 3.10, 0.5)).toBeCloseTo(-Math.PI, 2);
  });

  it('returns the endpoints exactly at t=0 and t=1', () => {
    expect(lerpAngle(1.2, -2.9, 0)).toBeCloseTo(1.2, 12);
    expect(lerpAngle(1.2, -2.9, 1)).toBeCloseTo(-2.9, 12);
  });
});

describe('sampleSnapshots', () => {
  it('returns null for an empty buffer', () => {
    // Distinct from a stalled actor: the caller needs to tell "no actor yet"
    // from "actor, but nothing new arrived".
    expect(sampleSnapshots([], 100)).toBeNull();
  });

  it('blends between the bracketing pair', () => {
    const out = sampleSnapshots([snap(1000, 0, 0), snap(2000, 6, 8)], 1500);
    expect(out.mode).toBe(INTERP_MODE.INTERPOLATED);
    expect(out.x).toBeCloseTo(3, 12);
    expect(out.z).toBeCloseTo(4, 12);
  });

  it('picks the correct pair out of several', () => {
    const snaps = [snap(0, 0, 0), snap(1000, 10, 0), snap(2000, 20, 0), snap(3000, 30, 0)];
    expect(sampleSnapshots(snaps, 2500).x).toBeCloseTo(25, 12);
    expect(sampleSnapshots(snaps, 500).x).toBeCloseTo(5, 12);
  });

  it('holds the newest when nothing newer has arrived', () => {
    // Never extrapolate. Dead reckoning looks better for ~50 ms and then snaps
    // back to truth, which reads worse than the freeze it was hiding.
    const out = sampleSnapshots([snap(100, 0, 0), snap(200, 10, 0)], 5000);
    expect(out.mode).toBe(INTERP_MODE.UNDERRUN);
    expect(out.x).toBe(10);
  });

  it('holds the oldest while the delay window is still filling', () => {
    const out = sampleSnapshots([snap(100, 7, 8, 1.5)], 0);
    expect(out.mode).toBe(INTERP_MODE.WARMUP);
    expect(out).toMatchObject({ x: 7, z: 8, yaw: 1.5 });
  });

  it('snaps instead of sliding through an impossible gap', () => {
    // 40 m in 50 ms is 800 m/s. Interpolating that draws an actor skating
    // across the map for a whole buffer window; a spawn or a rejoin should pop.
    const out = sampleSnapshots([snap(100, 0, 0), snap(150, 40, 0)], 125);
    expect(out.mode).toBe(INTERP_MODE.SNAPPED);
    expect(out.x).toBe(40);
  });

  it('still interpolates a fast but legitimate move', () => {
    // The threshold must not catch honest sprinting. 6.72 m/s (walker sprint)
    // over 50 ms is 0.336 m — nowhere near the teleport speed.
    const out = sampleSnapshots([snap(100, 0, 0), snap(150, 0.336, 0)], 125);
    expect(out.mode).toBe(INTERP_MODE.INTERPOLATED);
  });

  it('treats a zero-length span as a snap rather than dividing by zero', () => {
    // Guards the arithmetic: (render - a.t) / 0 is Infinity, and the blend
    // would emit NaN coordinates that propagate into the scene graph forever.
    const out = sampleSnapshots([snap(100, 0, 0), snap(100, 5, 5)], 100.5);
    expect(Number.isFinite(out.x)).toBe(true);
  });

  it('blends yaw by shortest arc, not by raw lerp', () => {
    const out = sampleSnapshots([snap(0, 0, 0, 3.10), snap(100, 0, 0, -3.10)], 50);
    expect(Math.abs(out.yaw)).toBeGreaterThan(3);
  });
});

describe('createSnapshotBuffer', () => {
  it('sorts out-of-order arrivals into a monotonic timeline', () => {
    // Jitter routinely delivers N+1 before N. A buffer that appended blindly
    // would hand the sampler a backwards pair and the actor would lurch.
    const buf = createSnapshotBuffer();
    buf.push(snap(100, 1, 0));
    buf.push(snap(300, 3, 0));
    buf.push(snap(200, 2, 0));
    expect(buf.toArray().map((s) => s.t)).toEqual([100, 200, 300]);
  });

  it('interpolates correctly after an out-of-order insert', () => {
    // The property that matters, not just the ordering: the late arrival must
    // actually be used as a bracket endpoint.
    const buf = createSnapshotBuffer();
    buf.push(snap(1000, 0, 0));
    buf.push(snap(3000, 20, 0));
    buf.push(snap(2000, 10, 0));
    expect(buf.sample(2500).x).toBeCloseTo(15, 12);
  });

  it('replaces a duplicate stamp instead of growing a zero-length span', () => {
    const buf = createSnapshotBuffer();
    buf.push(snap(100, 1, 0));
    buf.push(snap(100, 9, 0));
    expect(buf.size()).toBe(1);
    expect(buf.newest().x).toBe(9);
  });

  it('evicts the oldest past capacity', () => {
    const buf = createSnapshotBuffer({ capacity: 3 });
    for (let t = 100; t <= 500; t += 100) buf.push(snap(t, t / 100, 0));
    expect(buf.toArray().map((s) => s.t)).toEqual([300, 400, 500]);
  });

  it('refuses a snapshot older than a full buffer rather than evicting a newer one', () => {
    // Inserting pure history would trade a future the renderer has not reached
    // for a past it already passed.
    const buf = createSnapshotBuffer({ capacity: 3 });
    for (const t of [300, 400, 500]) buf.push(snap(t, 0, 0));
    expect(buf.push(snap(10, 99, 99))).toBe(false);
    expect(buf.droppedCount()).toBe(1);
    expect(buf.toArray().map((s) => s.t)).toEqual([300, 400, 500]);
  });

  it('rejects non-finite payloads at the door', () => {
    // One NaN would park the actor at NaN forever: every later comparison is
    // false, so nothing downstream ever notices or recovers.
    const buf = createSnapshotBuffer();
    expect(buf.push(snap(Number.NaN, 1, 1))).toBe(false);
    expect(buf.push(snap(100, Number.NaN, 1))).toBe(false);
    expect(buf.push(snap(100, 1, Number.POSITIVE_INFINITY))).toBe(false);
    expect(buf.size()).toBe(0);
  });

  it('defaults a missing yaw rather than propagating undefined', () => {
    const buf = createSnapshotBuffer();
    buf.push({ t: 100, x: 1, z: 2 });
    expect(buf.newest().yaw).toBe(0);
  });

  it('defaults its capacity from NET_TIMING', () => {
    const buf = createSnapshotBuffer();
    for (let t = 0; t < NET_TIMING.bufferCapacity + 5; t++) buf.push(snap(t * 50, 0, 0));
    expect(buf.size()).toBe(NET_TIMING.bufferCapacity);
  });

  it('rejects a capacity too small to hold a bracket', () => {
    // With capacity 1 there is never a pair to interpolate between, so every
    // sample would be a hold and the gate would pass while nothing interpolated.
    expect(() => createSnapshotBuffer({ capacity: 1 })).toThrow(/at least 2/);
  });
});
