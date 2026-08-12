/**
 * gaitVerify — the analyzers P9's exit bar runs. PURE, shared by the gates
 * and (later) any dev diagnostic.
 *
 * The foot-slide measurement simulates the whole pipeline headlessly: root
 * translates at `speedMps`, the odometer advances phase from that same
 * speed, the generator poses the rig, and each foot tip's WORLD position
 * (root translation + palette-transformed tip) is differenced frame to
 * frame. During a foot's STANCE half (swing moving rearward) its world
 * velocity should be ~zero; the report integrates |velocity| over stance and
 * normalises by body travel, so 0 is perfectly planted and 1 is a statue
 * dragging its feet — the P8 baseline this phase exists to beat.
 *
 * The analyzer asserts its own preconditions (nonzero speed, pose actually
 * varying) and throws on violation rather than returning a vacuously clean
 * report: a gate that measured a parked actor would read 0 slide and pass.
 */

import { buildActorRig, evaluatePose } from './actorRig.js';
import { archetypeById } from './actorMasses.js';
import { createOdometer, advanceOdometer, gaitPose, strideForSpeed } from './gait.js';

const applyBone = (palette, i, p) => {
  const o = i * 16;
  return [
    p[0] * palette[o] + p[1] * palette[o + 4] + p[2] * palette[o + 8] + palette[o + 12],
    p[0] * palette[o + 1] + p[1] * palette[o + 5] + p[2] * palette[o + 9] + palette[o + 13],
    p[0] * palette[o + 2] + p[1] * palette[o + 6] + p[2] * palette[o + 10] + palette[o + 14],
  ];
};

/**
 * @param {string} archetypeId  a WALK archetype ('unbound' | 'legion')
 * @param {object} [opts] { speedMps, seconds, fps, poseFn } — poseFn is
 *   injectable so sabotage fixtures can hand the analyzer a broken generator
 *   and prove the gate goes red.
 * @returns {{slideRatio: number, meanSlide: number, travelM: number, frames: number}}
 */
export function footSlideReport(archetypeId, {
  speedMps = 4.2, seconds = 4, fps = 60, poseFn = gaitPose,
} = {}) {
  if (!(speedMps > 0)) {
    throw new Error('[gaitVerify] foot-slide at zero speed is vacuous: a parked actor cannot slide. Command a speed.');
  }
  const rig = buildActorRig(archetypeId);
  const masses = new Map(archetypeById(archetypeId).masses.map((m) => [m.id, m]));
  const feet = ['legL', 'legR'].map((id) => ({
    bone: rig.bones.findIndex((b) => b.massIds.includes(id)),
    tip: masses.get(id).b, // the foot end
  }));
  if (feet.some((f) => f.bone < 0)) {
    throw new Error(`[gaitVerify] ${archetypeId} has no independent leg bones — the walk analyzer only applies to split-leg archetypes.`);
  }

  const odo = createOdometer();
  const dtMs = 1000 / fps;
  // Travel is +z: the walker convention is forward = (sin yaw, cos yaw), so
  // at yaw 0 the body moves along +z and the generator swings legs about X
  // into the +-z plane. The first version of this harness translated along
  // +x and measured slideRatio 1.0 — it was differencing the axis the legs
  // never swing in, a harness bug the drift gate itself caught.
  let rootZ = 0;
  let prev = null;
  let firstPalette = null;
  let paletteVaried = false;
  let stanceSlide = 0;
  let stanceTravel = 0;
  let signedSlide = 0;

  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) {
    rootZ += speedMps * (dtMs / 1000);
    advanceOdometer(odo, speedMps, dtMs, strideForSpeed(archetypeId, speedMps));
    const palette = evaluatePose(rig, poseFn(archetypeId, odo.phase, { speed: speedMps }));
    if (!firstPalette) firstPalette = palette;
    else if (!paletteVaried) paletteVaried = palette.some((v, k) => v !== firstPalette[k]);

    const tips = feet.map((f) => {
      const p = applyBone(palette, f.bone, f.tip);
      return [p[0], p[1], p[2] + rootZ];
    });
    if (prev) {
      // Stance is defined by the GENERATOR's own phase windows, not inferred
      // from velocities: legL's swing is +A·sin(2πφ), so its tip moves
      // rearward (is planted) while that sine falls — φ ∈ (0.25, 0.75) — and
      // legR holds the complement. An earlier classifier picked "whichever
      // foot has the lower z-velocity" and at low amplitude its noise
      // dominated the measurement (slideRatio 0.42 at 1 m/s, all of it
      // misclassification). The 0.06 inset skips the exchange instants,
      // where both feet legitimately move — real gaits call it double
      // support, and no foot is meaningfully "planted" inside it.
      // (Sign fixed by measurement: the first window assignment picked the
      // SWING foot — its mean velocity read +2.17× body speed, the signature
      // of a foot being carried forward. Planted and swinging swap here.)
      const inMidWindow = odo.phase > 0.31 && odo.phase < 0.69;
      const inEdgeWindow = odo.phase < 0.19 || odo.phase > 0.81;
      const f = inMidWindow ? 1 : inEdgeWindow ? 0 : -1;
      if (f >= 0) {
        const vz = (tips[f][2] - prev[f][2]) / (dtMs / 1000);
        stanceSlide += Math.abs(vz) * (dtMs / 1000);
        signedSlide += vz * (dtMs / 1000);
        stanceTravel += speedMps * (dtMs / 1000);
      }
    }
    prev = tips;
  }

  if (!paletteVaried) {
    throw new Error('[gaitVerify] the pose never varied across the run — the gate would be measuring a statue. Is the generator wired to the odometer?');
  }
  return {
    slideRatio: stanceSlide / stanceTravel,
    meanSlide: signedSlide / stanceTravel,
    travelM: rootZ,
    frames,
  };
}

/**
 * Magistari's inverted assertion: its motion must have NO step rhythm. Sample
 * the palette over a run and check the dominant beat of bone 1's angle is ONE
 * per cycle (the hover), never two (a walk's step-cross) — a legless robe
 * with a two-beat gait reads as walking under its skirt.
 * @returns {{oneBeat: number, twoBeat: number}} spectral magnitudes
 */
export function glideRhythmReport({ speedMps = 3, samples = 256, poseFn = gaitPose } = {}) {
  if (!(speedMps > 0)) throw new Error('[gaitVerify] glide rhythm at zero speed is vacuous.');
  let one = { re: 0, im: 0 };
  let two = { re: 0, im: 0 };
  for (let i = 0; i < samples; i++) {
    const phase = i / samples;
    const pose = poseFn('magistari', phase, { speed: speedMps });
    const angle = pose[1]?.angleRad ?? 0;
    const w1 = 2 * Math.PI * phase;
    one = { re: one.re + angle * Math.cos(w1), im: one.im + angle * Math.sin(w1) };
    two = { re: two.re + angle * Math.cos(2 * w1), im: two.im + angle * Math.sin(2 * w1) };
  }
  return {
    oneBeat: Math.hypot(one.re, one.im) / samples,
    twoBeat: Math.hypot(two.re, two.im) / samples,
  };
}
