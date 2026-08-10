/**
 * remoteInterpolation.test.js — P8's exit bar.
 *
 * "Remote players move smoothly under simulated latency" is an art note until
 * it is a number, and this file is where it becomes numbers. It composes the
 * real pieces — a scripted circular walk, the latency shaper, the playout clock
 * and the snapshot buffer — steps a 60 Hz render loop over them, and measures
 * the motion that comes out.
 *
 * ─── The vacuity guard is the most important assertion here ──────────────────
 * Every gate this project has shipped that could not fail eventually hid a real
 * bug (P6's winding, P7's rest-pose identity). A smoothness gate has an obvious
 * failure of that kind: run it at zero latency and zero jitter and it passes
 * while proving nothing, because there was nothing to smooth. So the schedule
 * itself is asserted — the run must actually have reordered snapshots, actually
 * have dropped some, and the interpolator must actually have spent its frames
 * interpolating rather than holding a frozen pose.
 */

import { describe, expect, it } from 'vitest';
import { EVENT } from './WorldTransport.js';
import { createSnapshotBuffer, normalizeAngle, INTERP_MODE } from './interpolate.js';
import { createPlayoutClock } from './playoutClock.js';
import {
  circleTruthAt,
  createPlaybackTransport,
  scriptCircle,
} from './transports/PlaybackTransport.js';
import {
  createLatencyShapedTransport,
  LINK_PROFILES,
} from './transports/LatencyShapedTransport.js';
import { MOVE_LIMITS } from './rules/moveRules.js';
import { SIM_STEP_MS } from '../model/simClock.js';

const WALK = { radiusM: 8, speedMps: 4.2, startMs: 0 };
const FRAME_MS = 1000 / 60;

/** The fastest the server would ever authorise: sprint x jitter tolerance. */
const SERVER_CEILING_MPS = MOVE_LIMITS.maxSpeedMps * MOVE_LIMITS.toleranceMult;

async function runScenario({ profile, seed = 1, durationMs = 8000 }) {
  let t = 0;
  const now = () => t;

  // Script runs past the window so the buffer is never starved by the script
  // simply ending — that would read as an underrun the network did not cause.
  const script = scriptCircle({ ...WALK, durationMs: durationMs + 2000 });
  const inner = createPlaybackTransport({ now, script });
  const shaped = createLatencyShapedTransport(inner, { now, ...profile, seed });

  const buffer = createSnapshotBuffer();
  const clock = createPlayoutClock();
  const arrivalStamps = [];

  shaped.subscribe((kind, p) => {
    if (kind !== EVENT.ENTITY_UPSERT) return;
    arrivalStamps.push(p.t);
    clock.observe(t, p.t);
    buffer.push({ t: p.t, x: p.x, z: p.z, yaw: p.yaw });
  });

  await shaped.connect('me');

  const frames = [];
  for (let i = 0; i * FRAME_MS <= durationMs; i++) {
    t = i * FRAME_MS;
    inner.pump(t);
    shaped.pump(t);

    const renderTimeMs = clock.renderTimeAt(t);
    if (renderTimeMs == null) continue;
    const sample = buffer.sample(renderTimeMs);
    if (sample) frames.push({ t, renderTimeMs, ...sample });
  }

  return { frames, arrivalStamps, shaped, buffer, clock };
}

function measure({ frames, arrivalStamps }) {
  const modes = {};
  let maxStepM = 0;
  let maxYawStepRad = 0;
  let maxDeviationM = 0;

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    modes[f.mode] = (modes[f.mode] ?? 0) + 1;

    const truth = circleTruthAt(f.renderTimeMs, WALK);
    maxDeviationM = Math.max(maxDeviationM, Math.hypot(f.x - truth.x, f.z - truth.z));

    if (i > 0) {
      const prev = frames[i - 1];
      maxStepM = Math.max(maxStepM, Math.hypot(f.x - prev.x, f.z - prev.z));
      maxYawStepRad = Math.max(maxYawStepRad, Math.abs(normalizeAngle(f.yaw - prev.yaw)));
    }
  }

  // How out-of-order the delivered stream actually was: how many arrivals
  // carried a stamp older than one already seen.
  let inversions = 0;
  let high = -Infinity;
  for (const stamp of arrivalStamps) {
    if (stamp < high) inversions += 1;
    else high = stamp;
  }

  const interpolated = modes[INTERP_MODE.INTERPOLATED] ?? 0;
  return {
    frames: frames.length,
    modes,
    inversions,
    maxStepM,
    maxYawStepRad,
    maxDeviationM,
    interpolatedFraction: frames.length ? interpolated / frames.length : 0,
    impliedMps: maxStepM / (FRAME_MS / 1000),
  };
}

describe('P8 exit bar: remote players move smoothly under simulated latency', () => {
  for (const [name, profile] of Object.entries(LINK_PROFILES)) {
    describe(name, () => {
      it('moves without a visible discontinuity', async () => {
        const m = measure(await runScenario({ profile, seed: 17 }));

        // The core claim, and the reason the bound is the SCRIPTED speed rather
        // than the server ceiling: a rendered actor should move at the speed it
        // is actually walking, not merely at some speed the server would have
        // tolerated. Measured across all four profiles the worst frame lands at
        // 4.20-4.45 m/s against a 4.2 m/s walk, so 1.5x is comfortable headroom
        // while still being far tighter than the 9.45 m/s outer bound — the
        // regressions this caught in development ran 12.6 to 37.8 m/s.
        const bound = WALK.speedMps * 1.5;
        expect(bound).toBeLessThan(SERVER_CEILING_MPS);
        expect(
          m.impliedMps,
          `${name}: rendered motion implied ${m.impliedMps.toFixed(2)} m/s `
          + `for an actor walking at ${WALK.speedMps} m/s`,
        ).toBeLessThanOrEqual(bound);
      });

      it('never runs the buffer dry', async () => {
        const m = measure(await runScenario({ profile, seed: 17 }));
        // What sizing the delay for lost snapshots bought. Before it, two
        // consecutive drops opened a 150 ms hole against a 100 ms delay and
        // 16% of frames on the mobile profile had nothing to interpolate
        // toward. Underrun is not merely inelegant: every frame of it is a
        // frozen actor that then closes the gap in one visible step.
        const underrun = m.modes.underrun ?? 0;
        expect(
          underrun / m.frames,
          `${name}: ${underrun} of ${m.frames} frames had no future snapshot `
          + `(modes: ${JSON.stringify(m.modes)})`,
        ).toBeLessThan(0.01);
      });

      it('turns without spinning the long way round', async () => {
        const m = measure(await runScenario({ profile, seed: 17 }));
        // A circular walk at 4.2 m/s on an 8 m radius turns 0.525 rad/s, so a
        // frame may legitimately turn ~0.009 rad. A lerp that took the long way
        // across the seam would show up here as a near-2pi step.
        expect(m.maxYawStepRad).toBeLessThan(0.1);
      });

      it('tracks the true path rather than drifting or freezing', async () => {
        const m = measure(await runScenario({ profile, seed: 17 }));
        // Smoothness alone is satisfiable by never moving. This is the
        // assertion that makes the gate mean something: the rendered actor has
        // to actually be where the script says it was.
        expect(
          m.maxDeviationM,
          `${name}: drifted ${m.maxDeviationM.toFixed(3)} m from the scripted path`,
        ).toBeLessThan(0.5);
      });

      it('spends its frames interpolating, not holding', async () => {
        const m = measure(await runScenario({ profile, seed: 17 }));
        // Guards the second vacuity class: a buffer that underran constantly
        // would hold a frozen pose, which is trivially "smooth" and completely
        // wrong. The interpolator has to be doing its job most of the time.
        expect(
          m.interpolatedFraction,
          `${name}: only ${(m.interpolatedFraction * 100).toFixed(1)}% of frames interpolated `
          + `(modes: ${JSON.stringify(m.modes)})`,
        ).toBeGreaterThan(0.9);
      });
    });
  }

  it('the hostile profile really is hostile', async () => {
    // THE anti-vacuity assertion. Everything above would pass on a perfect link
    // while proving nothing, so the schedule itself is on trial here: this run
    // must genuinely have reordered snapshots and genuinely have lost some.
    const scenario = await runScenario({ profile: LINK_PROFILES.FLAKY_WIFI, seed: 17 });
    const m = measure(scenario);

    expect(m.inversions, 'no snapshot ever arrived out of order').toBeGreaterThan(0);
    expect(scenario.shaped.droppedCount(), 'no snapshot was ever dropped').toBeGreaterThan(0);
    expect(m.frames, 'the render loop produced no frames to judge').toBeGreaterThan(100);
  });

  it('holds still rather than inventing motion when the stream stops', async () => {
    // Deliberate underrun: the script ends but the clock keeps running. The
    // actor must freeze at its last known pose, not dead-reckon into the void.
    let t = 0;
    const now = () => t;
    const script = scriptCircle({ ...WALK, durationMs: 1000 });
    const inner = createPlaybackTransport({ now, script });
    const buffer = createSnapshotBuffer();
    const clock = createPlayoutClock();
    inner.subscribe((kind, p) => {
      if (kind !== EVENT.ENTITY_UPSERT) return;
      clock.observe(t, p.t);
      buffer.push({ t: p.t, x: p.x, z: p.z, yaw: p.yaw });
    });
    await inner.connect('me');

    for (let i = 0; i * FRAME_MS <= 1200; i++) { t = i * FRAME_MS; inner.pump(t); }
    const settled = buffer.sample(clock.renderTimeAt(t));

    t = 60_000;
    const muchLater = buffer.sample(clock.renderTimeAt(t));
    expect(muchLater.mode).toBe(INTERP_MODE.UNDERRUN);
    expect(muchLater.x).toBeCloseTo(buffer.newest().x, 12);
    expect(settled).toBeTruthy();
  });

  it('renders one sim step behind at most, once the clock has settled', async () => {
    // The delay is a budget, not a suggestion: a playout clock that drifted
    // would add unbounded lag while every smoothness assertion stayed green.
    const { clock } = await runScenario({ profile: LINK_PROFILES.BROADBAND, seed: 5 });
    const expectedOffset = LINK_PROFILES.BROADBAND.latencyMs;
    expect(clock.offset()).toBeGreaterThanOrEqual(expectedOffset - SIM_STEP_MS);
    expect(clock.offset()).toBeLessThan(expectedOffset + LINK_PROFILES.BROADBAND.jitterMs);
  });
});
