/**
 * gait.test.js — P9's exit bar: "idle/run/combat/cast blending with no
 * foot-slide", as numbers.
 *
 * RED-FIRST DOCTRINE: every analyzer here first proves it FAILS on a
 * deliberately broken input before its pass on the real generator counts.
 * This project has shipped gates that could not fail twice (P6 winding, P7
 * rest identity); the sabotage fixtures are the structural version of never
 * doing that again. The sabotages are the real failure modes: a TIME-driven
 * phase (the classic foot-slide bug — feet cycle at their own rate while the
 * ground passes underneath), a frozen pose, and a two-beat glide.
 */
import { describe, expect, it } from 'vitest';
import {
  STRIDE_LENGTH_M, advanceOdometer, createOdometer, gaitPose, gaitRootMotion,
} from './gait.js';
import { footSlideReport, glideRhythmReport } from './gaitVerify.js';
import { buildActorRig } from './actorRig.js';
import {
  ANIM_STATE, BLEND_MS, MIN_DWELL_MS, createAnimState, requestState, updateAnimState,
} from '../sim/animState.js';

const WALKERS = ['unbound', 'legion'];
const IDS = ['unbound', 'legion', 'magistari', 'orghon'];

describe('the odometer', () => {
  it('freezes phase at zero speed — foot-slide is unrepresentable, half one', () => {
    const odo = createOdometer();
    advanceOdometer(odo, 4.2, 1000);
    const frozen = odo.phase;
    for (let i = 0; i < 100; i++) advanceOdometer(odo, 0, 16);
    expect(odo.phase).toBe(frozen);
  });

  it('advances exactly one cycle per stride length — half two', () => {
    const odo = createOdometer();
    // Four 250 ms steps: one second of travel at stride-per-second speed,
    // fed in chunks the stall clamp does not truncate.
    for (let i = 0; i < 4; i++) advanceOdometer(odo, STRIDE_LENGTH_M, 250);
    expect(odo.phase).toBeCloseTo(0, 10); // wrapped a full cycle
    expect(odo.distanceM).toBeCloseTo(STRIDE_LENGTH_M, 10);
  });

  it('clamps a stall like the sim clock does', () => {
    const odo = createOdometer();
    advanceOdometer(odo, 4.2, 120_000); // two minutes "elapsed"
    expect(odo.distanceM).toBeLessThanOrEqual(4.2 * 0.25 + 1e-9);
  });

  it('ignores garbage rather than poisoning distance', () => {
    const odo = createOdometer();
    advanceOdometer(odo, Number.NaN, 16);
    advanceOdometer(odo, 4, Number.NaN);
    advanceOdometer(odo, -5, 16); // speed is a magnitude
    expect(odo.distanceM).toBe(0);
  });
});

describe('foot-slide — the exit bar, red first', () => {
  it('the analyzer REJECTS a zero-speed run as vacuous', () => {
    expect(() => footSlideReport('unbound', { speedMps: 0 })).toThrow(/vacuous/);
  });

  it('the analyzer REJECTS a generator that never varies the pose', () => {
    expect(() => footSlideReport('unbound', { poseFn: () => ({}) })).toThrow(/statue/);
  });

  it('goes RED on the classic bug: time-driven phase', () => {
    // Feet cycling on a wall clock while the body moves at its own speed is
    // THE foot-slide failure. Phase here advances at a fixed rate with no
    // relation to distance — the sabotage every naive implementation ships.
    let t = 0;
    const timeDriven = (id, _phase, params) => {
      t += 1 / 60;
      return gaitPose(id, (t * 0.7) % 1, params);
    };
    const r = footSlideReport('unbound', { speedMps: 1.0, poseFn: timeDriven });
    expect(
      r.slideRatio,
      'time-driven phase should slide massively — if this passes, the analyzer is blind',
    ).toBeGreaterThan(0.5);
  });

  it('goes RED on a frozen gait dragged across the ground', () => {
    const frozen = (id) => gaitPose(id, 0.2, { speed: 4.2 });
    // A constant non-rest pose: the palette varies... it does not, so the
    // statue precondition catches it first — which IS the red result.
    expect(() => footSlideReport('unbound', { poseFn: frozen })).toThrow(/statue/);
  });

  for (const id of WALKERS) {
    it(`${id} walks with bounded stance slide at three speeds`, () => {
      // One bone per leg means no ankle: the stance foot tracks ground with
      // a near-zero-mean residual (see strideForSpeed's calibration). The
      // gate bounds both statistics: the mean (drift — the thing that reads
      // as skating; measured +0.034..0.038) and the integrated |slide| ratio
      // (the shape residual; measured 0.215..0.231). The P8 statue baseline
      // is 1.0 by definition, and the time-driven sabotage above measures
      // >0.5 — both bounds sit far from everything except honest gait.
      for (const speedMps of [1.0, 2.5, 4.2]) {
        const r = footSlideReport(id, { speedMps });
        expect(Math.abs(r.meanSlide), `${id} drifts at ${speedMps} m/s`).toBeLessThan(0.08);
        expect(r.slideRatio, `${id} slides at ${speedMps} m/s`).toBeLessThan(0.30);
      }
    });
  }
});

describe('the glide — magistari, inverted assertion', () => {
  it('the rhythm analyzer goes RED on a two-beat (walking) glide', () => {
    const walkingRobe = (id, phase) => ({
      1: { axis: [0, 0, 1], angleRad: 0.1 * Math.sin(phase * Math.PI * 4) }, // two beats
    });
    const r = glideRhythmReport({ poseFn: walkingRobe });
    expect(r.twoBeat).toBeGreaterThan(r.oneBeat);
  });

  it('the real glide is one-beat: a hover, not a walk under a skirt', () => {
    const r = glideRhythmReport({});
    expect(r.oneBeat).toBeGreaterThan(r.twoBeat * 3);
  });

  it('a stopped robe is perfectly still, root motion included', () => {
    const pose = gaitPose('magistari', 0.37, { speed: 0 });
    expect(Object.keys(pose)).toHaveLength(0);
    expect(gaitRootMotion('magistari', 0.37, { speed: 0 }).bobM).toBe(0);
  });
});

describe('the generator, structurally', () => {
  it.each(IDS)('%s never poses bone 0 — root entries move the feet', (id) => {
    for (const phase of [0, 0.13, 0.5, 0.86]) {
      const pose = gaitPose(id, phase, { speed: 4.2, combatIntensity: 1, castCharge: 1 });
      expect(pose[0]).toBeUndefined();
    }
  });

  it.each(IDS)('%s emits only bones its rig has, with unit axes', (id) => {
    const n = buildActorRig(id).bones.length;
    const pose = gaitPose(id, 0.31, { speed: 4.2, combatIntensity: 0.7, castCharge: 0.4 });
    for (const [k, e] of Object.entries(pose)) {
      expect(Number(k)).toBeLessThan(n);
      expect(Math.hypot(...e.axis)).toBeCloseTo(1, 9);
    }
  });

  it('is a pure function: same inputs, byte-identical palette', () => {
    // The LOD-invariance and determinism carrier: pose is f(phase, params),
    // so tier swaps and replays cannot diverge.
    const a = gaitPose('unbound', 0.42, { speed: 3, combatIntensity: 0.5, castCharge: 0.2 });
    const b = gaitPose('unbound', 0.42, { speed: 3, combatIntensity: 0.5, castCharge: 0.2 });
    expect(a).toEqual(b);
  });

  it('cast posture ramps MONOTONICALLY with charge — the body is the cast bar', () => {
    for (const id of IDS) {
      let prev = -Infinity;
      for (let c = 0; c <= 1.001; c += 0.1) {
        const pose = gaitPose(id, 0.5, { speed: 0, castCharge: Math.min(c, 1) });
        const raise = Math.max(...Object.values(pose).map((e) => Math.abs(e.angleRad)), 0);
        expect(raise, `${id} at charge ${c.toFixed(1)}`).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = raise;
      }
      expect(prev).toBeGreaterThan(0.1); // and it actually raised something
    }
  });

  it('bipeds get a compass-gait bob that scales with stride and never digs in', () => {
    for (let phase = 0; phase < 1; phase += 0.05) {
      const m = gaitRootMotion('unbound', phase, { speed: 4.2 });
      expect(m.bobM).toBeGreaterThanOrEqual(0);
      expect(m.bobM).toBeLessThan(0.05);
    }
  });
});

describe('the state router', () => {
  it('a jittery derived speed cannot strobe idle/run — hysteresis plus dwell', () => {
    // The chaos replay, deterministic: speed oscillating right across the
    // threshold at frame rate, the exact signal a network-interpolated
    // remote produces. Transitions must be rare, not per-frame.
    const s = createAnimState();
    let transitions = 0;
    let last = s.state;
    let flip = 1;
    for (let ms = 0; ms < 10_000; ms += 16) {
      flip = -flip;
      const noisy = 0.35 + flip * 0.25; // 0.10 .. 0.60, straddling both thresholds
      updateAnimState(s, noisy, ms);
      if (s.state !== last) { transitions++; last = s.state; }
    }
    expect(transitions).toBeLessThanOrEqual(2);
  });

  it('a genuine stop still lands in idle, just not instantly', () => {
    const s = createAnimState();
    for (let ms = 0; ms < 2000; ms += 16) updateAnimState(s, 4.2, ms);
    expect(s.state).toBe(ANIM_STATE.RUN);
    for (let ms = 2000; ms < 4000; ms += 16) updateAnimState(s, 0, ms);
    expect(s.state).toBe(ANIM_STATE.IDLE);
  });

  it('blends parameters over BLEND_MS instead of snapping', () => {
    const s = createAnimState();
    updateAnimState(s, 0, 1000);
    requestState(s, ANIM_STATE.COMBAT, 1000);
    updateAnimState(s, 0, 1000 + BLEND_MS / 2);
    expect(s.params.combatIntensity).toBeGreaterThan(0.2);
    expect(s.params.combatIntensity).toBeLessThan(0.8);
    updateAnimState(s, 0, 1000 + BLEND_MS + 1);
    expect(s.params.combatIntensity).toBeCloseTo(1, 6);
  });

  it('cast entry is never dwell-blocked; other commands are', () => {
    const s = createAnimState();
    updateAnimState(s, 0, 0);
    requestState(s, ANIM_STATE.COMBAT, 100); // inside the initial dwell? no — enteredAt is -inf
    expect(s.state).toBe(ANIM_STATE.COMBAT);
    // Immediately re-request something else: dwell blocks it...
    requestState(s, ANIM_STATE.IDLE, 150);
    expect(s.state).toBe(ANIM_STATE.COMBAT);
    // ...but a cast cuts through.
    requestState(s, ANIM_STATE.CAST, 160);
    expect(s.state).toBe(ANIM_STATE.CAST);
    expect(s.castProgress).toBe(0);
  });

  it('cast posture follows castProgress through the router', () => {
    const s = createAnimState();
    updateAnimState(s, 0, 0);
    requestState(s, ANIM_STATE.CAST, 0);
    s.castProgress = 0.8;
    updateAnimState(s, 0, BLEND_MS + 10);
    expect(s.params.castCharge).toBeCloseTo(0.8, 6);
  });
});
