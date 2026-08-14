/**
 * gait — where every bone sits, given how far the body has walked.
 *
 * PURE. One generator per archetype: `gaitPose(archetypeId, phase, params)`
 * returns the per-bone {axis, angleRad} table `evaluatePose`/`setPose` consume.
 * No keyframe clips exist anywhere in this system — a pose is a function, and
 * "clips" are regions of the parameter space.
 *
 * ─── Phase is DISTANCE, never time ───────────────────────────────────────────
 * `advanceOdometer` integrates horizontal speed into metres travelled, and
 * phase = distance / stride. A foot is planted during its stance half, the
 * body travels one stride per cycle by construction, and stopping freezes
 * the walk mid-stride exactly where the limbs are. That makes the CLASS of
 * foot-slide bug (feet cycling on a clock while the ground passes)
 * structurally excluded — but with one bone per leg the stance foot still
 * carries a bounded residual (measured |slide| ratio 0.215..0.231, mean
 * +0.034..0.038), so the honest word is BOUNDED, not impossible, and
 * gait.test.js's gate holds the bound rather than taking this paragraph's
 * word for anything.
 *
 * ─── Blending happens in PARAMETER space ─────────────────────────────────────
 * `params` is {speed, combatIntensity, castCharge}, each continuous. The
 * state machine (sim/animState.js) crossfades the PARAMETER VECTOR and this
 * one generator consumes the blended result — two clips can never fight over
 * a bone, and there is no mid-blend pose pair to get wrong, because there is
 * never more than one pose.
 *
 * ─── Per-archetype verbs ─────────────────────────────────────────────────────
 * unbound/legion WALK on the legs P9's genome split gave them (swing ∝ speed,
 * counter-phase, torso lean into motion). magistari GLIDES — it has no legs
 * by design, so its motion is a heading-lagged robe sway plus a slow hover
 * ripple driven by phase (distance-locked, so even the ripple freezes when
 * the robe stops). orghon LURCHES: its whole lower body is one fused
 * hip-cluster bone (all four hip/thigh masses share one pivot — that fusion
 * is load-bearing, its throat weld is pose-locked), so its gait is a rolling
 * pelvis pulse with arm counter-swing. The verb IS faction identity at
 * distance, extending P6's silhouette doctrine into motion.
 *
 * ─── The amplitudes sit inside the canary-certified envelope ──────────────────
 * Every angle below is smaller than the canary angle certified for its bone
 * (worst canary overhang 0.3381 m vs the 0.41 m margin). That is an authored
 * discipline plus the envelope audit — NOT a swept proof: a full
 * (phase × params) hypercube sweep through the seal machinery is a named
 * carry-forward, and until it exists no comment here may claim otherwise.
 */

import { buildActorRig } from './actorRig.js';
import { archetypeById } from './actorMasses.js';

/**
 * The NOMINAL cycle length, metres — the rhythm period for verbs with no
 * feet to plant (magistari's hover beat, orghon's lurch pulse). Walk
 * archetypes never use this number: their stride is derived per-speed by
 * `strideForSpeed`, where the ground-tracking identity actually lives.
 */
export const STRIDE_LENGTH_M = 1.29;

/** Leg length per walk archetype, |b - a| of a leg mass, resolved lazily from
 *  the genome so a re-authored leg keeps the identity true automatically. */
const LEG_LENGTH = new Map();
function legLength(archetypeId) {
  let l = LEG_LENGTH.get(archetypeId);
  if (l === undefined) {
    const arch = archetypeById(archetypeId);
    const leg = arch?.masses.find((m) => m.id === 'legL');
    l = leg ? Math.hypot(leg.b[0] - leg.a[0], leg.b[1] - leg.a[1], leg.b[2] - leg.a[2]) : null;
    LEG_LENGTH.set(archetypeId, l);
  }
  return l;
}

/**
 * The stride the CURRENT speed produces — the other half of the ground-
 * tracking identity. Swing amplitude scales with speed (a slow walk does not
 * pump full-stride), so the distance one cycle covers must scale WITH it:
 * measured with a fixed 1.29 m stride, walking at 1 m/s drifted the stance
 * foot at 0.76 of body speed, because the scaled-down swing could only
 * cancel a quarter of the travel. Deriving stride from the SAME amplitude
 * the generator will use makes the identity hold at every speed — slower
 * walkers take shorter steps at near-constant cadence, which is also what
 * legged bodies actually do. Non-walk archetypes keep the nominal stride:
 * their pulse has no foot to plant, only a rhythm to keep.
 */
export function strideForSpeed(archetypeId, speedMps) {
  const lever = legLength(archetypeId);
  if (lever == null) return STRIDE_LENGTH_M;
  const strideFactor = Math.min(Math.max(0, speedMps) / FULL_SWING_SPEED_MPS, 1);
  // Two steps per cycle, each a chord of the scaled swing. The tiny-speed
  // limit degenerates to zero stride / infinite cadence; floor it at 5% so
  // the phase rate stays finite (below walking pace nothing reads anyway).
  const amp = SWING.leg * Math.max(strideFactor, 0.05);
  // 5·sin(amp)·lever, and the 5 is MEASURED, not derived: the chord argument
  // (2 steps × 2·sin(amp)·lever = a 4× factor) ignores that the stance
  // window integrates |cos| of the swing, not its peak, and shipped a stance
  // foot moving BACKWARD at 0.2× body speed. Calibrated against
  // footSlideReport across 1.0/2.5/4.2 m/s: mean slide +0.034..0.038,
  // |slide| ratio 0.215..0.231, stable in speed — the gate holds both.
  return 5 * Math.sin(amp) * lever;
}

/** Above this speed the swing amplitudes stop growing — sprinting swings no
 *  harder than a fast run, it just cycles faster (phase advances with speed
 *  by construction). Matches the walker's sprint of 6.72 m/s. */
const FULL_SWING_SPEED_MPS = 4.2;

/** Peak joint swings, radians. Sized against the canary sweep: every value
 *  sits at or under the angle magnitude the seals certified for its bone. */
const SWING = Object.freeze({
  leg: 0.42, // ±24° thigh swing at full stride
  hipRoll: 0.055, // pelvis counter-roll
  torsoLean: 0.07, // forward lean into travel, speed-scaled
  arm: 0.30, // arm counter-swing (walk archetypes)
  glideSway: 0.10, // magistari hem sway
  glideRipple: 0.045, // magistari hover ripple
  lurchPulse: 0.16, // orghon pelvis pulse
  combatCrouch: 0.14, // posture layer: combat stance
  castRaise: 0.38, // posture layer: cast arm raise at full charge
  castCoil: 0.10, // posture layer: spine coil at full charge
});

const TAU = Math.PI * 2;
const X = Object.freeze([1, 0, 0]);
const Z = Object.freeze([0, 0, 1]);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Distance-driven phase state. Plain data in, plain data out — the caller owns
 * the object (one per actor) and hands each frame's horizontal speed in.
 */
export function createOdometer() {
  return { distanceM: 0, phase: 0 };
}

export function advanceOdometer(odo, speedMps, dtMs, strideM = STRIDE_LENGTH_M) {
  if (!Number.isFinite(speedMps) || !Number.isFinite(dtMs)) return odo;
  if (!(strideM > 0)) return odo;
  // Speed can never be negative (it is a magnitude), and dt clamps the same
  // way the sim clock's spiral guard does: a stalled tab resumes one step on,
  // not one lap on.
  const dm = Math.max(0, speedMps) * (Math.min(Math.max(dtMs, 0), 250) / 1000);
  odo.distanceM += dm;
  // Phase advances INCREMENTALLY by the stride in force this frame — stride
  // varies with speed (see strideForSpeed), so dividing total distance by a
  // single stride would jump the phase whenever the walker changed pace.
  odo.phase = (odo.phase + dm / strideM) % 1;
  return odo;
}

/**
 * Bone-index tables per archetype, resolved once from the real rig rather
 * than hardcoded — if the genome reorders BFS, these follow it, and the
 * mismatch surface is one lookup instead of a dozen magic numbers.
 */
function indicesFor(rig) {
  const byId = new Map(rig.bones.map((b, i) => [b.boneId, i]));
  const owning = (massId) => rig.bones.findIndex((b) => b.massIds.includes(massId));
  return { byId, owning };
}

const RIGS = new Map();
function rigFor(archetypeId) {
  let r = RIGS.get(archetypeId);
  if (!r) {
    const rig = buildActorRig(archetypeId);
    r = { rig, idx: indicesFor(rig) };
    RIGS.set(archetypeId, r);
  }
  return r;
}

/** Rodrigues, row-major row-vector — the same expansion evaluatePose uses,
 *  duplicated here because composition must happen in the identical
 *  convention the palette will apply. */
function rotM(ax, ay, az, angle) {
  const s = Math.sin(angle);
  const cs = Math.cos(angle);
  const t = 1 - cs;
  return [
    t * ax * ax + cs, t * ax * ay + s * az, t * ax * az - s * ay,
    t * ax * ay - s * az, t * ay * ay + cs, t * ay * az + s * ax,
    t * ax * az + s * ay, t * ay * az - s * ax, t * az * az + cs,
  ];
}

const mul3 = (a, b) => {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
};

/** Inverse of rotM: matrix back to {axis, angleRad}, null at identity. The
 *  skew-part signs match rotM's own layout (m[5]-m[7] = 2·sin·ax, etc.), so
 *  extract(rotM(...)) round-trips — asserted in gait.test.js. */
function toAxisAngle(m) {
  const c = Math.min(1, Math.max(-1, (m[0] + m[4] + m[8] - 1) / 2));
  const angle = Math.acos(c);
  if (angle < 1e-9) return null;
  const s2 = 2 * Math.sin(angle);
  const axis = [(m[5] - m[7]) / s2, (m[6] - m[2]) / s2, (m[1] - m[3]) / s2];
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  return { axis: Object.freeze([axis[0] / n, axis[1] / n, axis[2] / n]), angleRad: angle };
}

/**
 * Record a rotation for `bone`. Contributions are COMPOSED at finalize time
 * — never discarded. The first version kept whichever axis had the larger
 * angle on conflict, and review probed the consequence: walk+combat was
 * bit-identical to walk above ~2.65 m/s, because the arm's X swing outgrew
 * the combat guard's Z and silently ate it. "Idle/run/combat/cast BLENDING"
 * is the exit bar; a layer that evaporates under another is not blending.
 */
function contribute(table, bone, axis, angleRad) {
  if (bone < 0 || angleRad === 0) return;
  if (!table[bone]) table[bone] = [];
  table[bone].push({ axis, angleRad });
}

/** Lists → single {axis, angleRad} per bone, composing in contribution
 *  order (gait first, posture layers after — row-vector R1·R2). */
function finalize(table, boneCount) {
  const out = {};
  for (const [k, list] of Object.entries(table)) {
    const bone = Number(k);
    if (bone <= 0 || bone >= boneCount) continue; // no-root rule; see below
    if (list.length === 1) {
      out[bone] = { axis: list[0].axis, angleRad: list[0].angleRad };
      continue;
    }
    let m = rotM(list[0].axis[0], list[0].axis[1], list[0].axis[2], list[0].angleRad);
    for (let i = 1; i < list.length; i++) {
      m = mul3(m, rotM(list[i].axis[0], list[i].axis[1], list[i].axis[2], list[i].angleRad));
    }
    const e = toAxisAngle(m);
    if (e) out[bone] = e;
  }
  return out;
}

/**
 * The generator. `phase` in [0,1) from the odometer; `params`:
 *   speed          horizontal m/s (drives swing amplitude and lean)
 *   combatIntensity [0..1] posture layer: crouch + arm guard
 *   castCharge      [0..1] posture layer: monotone arm raise + spine coil —
 *                   the AMPLITUDE IS THE CAST BAR: a player at range reads
 *                   remaining cast time off the posture ramp itself.
 * @returns {Record<number, {axis: number[], angleRad: number}>} for setPose.
 */
export function gaitPose(archetypeId, phase, params = {}) {
  const { rig, idx } = rigFor(archetypeId);
  const speed = Math.max(0, params.speed ?? 0);
  const combat = clamp01(params.combatIntensity ?? 0);
  const cast = clamp01(params.castCharge ?? 0);
  const stride = Math.min(speed / FULL_SWING_SPEED_MPS, 1);
  const s = Math.sin(phase * TAU);
  const table = {};

  if (archetypeId === 'unbound' || archetypeId === 'legion') {
    // WALK. Legs counter-phase about X (the world axis perpendicular to
    // travel in body space — the root node's yaw carries heading, so gait
    // authors in the rig's own frame). Stance is the half-cycle where the
    // swing reverses; the odometer guarantees ground-truth distance.
    contribute(table, idx.owning('legL'), X, SWING.leg * stride * s);
    contribute(table, idx.owning('legR'), X, -SWING.leg * stride * s);
    contribute(table, idx.owning('hipL'), Z, SWING.hipRoll * stride * s);
    // Lean lives on the SHOULDER cluster, never bone 0: the root bone owns
    // the whole skeleton, so a root lean tilts the legs with it — measured as
    // ~6 cm of injected foot drift at 4°, which is the exact artefact the
    // foot-slide gate exists to catch. Leaning the upper body only is both
    // the honest mechanics and the readable silhouette.
    contribute(table, idx.owning('neck'), X, SWING.torsoLean * stride);
    // Arms counter-swing the legs. Unbound's graft arm is deliberately
    // stiffer (half amplitude): a hypertrophied graft does not pump.
    contribute(table, idx.owning('armL'), X, -SWING.arm * stride * s);
    const armR = idx.owning('armR');
    if (armR >= 0) contribute(table, armR, X, SWING.arm * stride * s);
    const graft = idx.owning('graftUpper');
    if (graft >= 0) contribute(table, graft, X, (SWING.arm / 2) * stride * s);
  } else if (archetypeId === 'magistari') {
    // GLIDE. Magistari's skeleton is nearly all ROOT: its one cap pivot is
    // head→spine, so bone 1 owns only the spine antenna — the robe, sleeves,
    // cowl and head are all ring-fused onto bone 0, which the no-root rule
    // below rightly zeroes. The glide verb therefore lives in ROOT MOTION
    // (`gaitRootMotion`: hover bob + heading lean on the root NODE — the
    // seatOn/Euler domain, outside the skeleton entirely); the palette's
    // whole contribution is the spine flourish, phase-locked like everything
    // else so a stopped robe is still.
    contribute(table, 1, Z, SWING.glideSway * stride * s);
  } else {
    // LURCH (orghon and any future fused-lower-body archetype): the single
    // hip-cluster bone rolls with the stride while the torso counter-leans;
    // arms swing low and heavy.
    contribute(table, idx.owning('hipL'), Z, SWING.lurchPulse * stride * s);
    contribute(table, idx.owning('neck'), X, SWING.torsoLean * 1.5 * stride);
    contribute(table, idx.owning('armLUpper'), X, -SWING.arm * 0.7 * stride * s);
    contribute(table, idx.owning('armRUpper'), X, SWING.arm * 0.7 * stride * s);
  }

  // ── Posture layers: combat crouch and cast charge, additive, state-free ──
  // The crouch lives on the neck/shoulder cluster (magistari, with no neck
  // mass, braces its bone-1 upper cluster instead) — NEVER bone 0. The first
  // version authored it on the root and the no-root guard silently deleted
  // it: idle combat was one arm twitch on the bipeds and an EMPTY pose on
  // magistari/orghon, found by review probing the palette, not the params.
  if (combat > 0) {
    const crouchBone = idx.owning('neck') >= 0 ? idx.owning('neck') : 1;
    contribute(table, crouchBone, X, SWING.combatCrouch * combat);
    const guard = [idx.owning('armL'), idx.owning('armLUpper')].find((b) => b >= 0);
    if (guard !== undefined) contribute(table, guard, Z, 0.18 * combat);
  }
  if (cast > 0) {
    // MONOTONE in castCharge, asserted by the harness: posture that ramps
    // linearly is posture a player can read remaining cast time from.
    const castArm = idx.owning('graftUpper') >= 0 ? idx.owning('graftUpper')
      : idx.owning('armR') >= 0 ? idx.owning('armR')
        : idx.owning('sleeveL') >= 0 ? 1
          : idx.owning('armRUpper');
    contribute(table, castArm, Z, -SWING.castRaise * cast);
    // Spine coil rides the neck/shoulder cluster (bone 1 on magistari),
    // same no-root rule as the lean.
    const coilBone = idx.owning('neck') >= 0 ? idx.owning('neck') : 1;
    contribute(table, coilBone, X, -SWING.castCoil * cast);
  }

  // finalize composes multi-contribution bones and enforces the structural
  // rules: never a bone the rig lacks, and NEVER bone 0 — the root bone owns
  // the entire skeleton, so a root entry moves the feet and the foot-slide
  // gate would measure this file's bug instead of the animation's quality.
  return finalize(table, rig.bones.length);
}

/**
 * The ROOT-MOTION channel: what the actor's root NODE does, alongside the
 * palette. Consumed by view/ as a seatOn Y offset and Euler lean — never as
 * bone translation (that path is sealed; see ActorRig.setPose's doctrine).
 * Pure function of the same (phase, params), so it freezes with the odometer
 * exactly like the palette does.
 *
 * This channel exists because of magistari: its rig is nearly all root bone
 * (one cap pivot), so a legless glide CANNOT be expressed in the palette at
 * all — the hover IS its gait. The bipeds reuse the same channel for the
 * compass-gait bob (a stiff-legged walk rises at mid-stance and falls at
 * step-cross; without the bob the geometry reads as roller skates), and
 * orghon for its heavier waddle bounce.
 *
 * @returns {{bobM: number, leanRad: number}} bob is metres ABOVE seat level
 *   (never below: the seat is ground contact); lean is a signed roll about
 *   the travel axis.
 */
export function gaitRootMotion(archetypeId, phase, params = {}) {
  const speed = Math.max(0, params.speed ?? 0);
  const stride = Math.min(speed / FULL_SWING_SPEED_MPS, 1);
  const c2 = Math.cos(phase * TAU * 2); // two beats per cycle: one per step
  if (archetypeId === 'magistari') {
    return {
      // The hover: a slow, low ripple, one beat per cycle — deliberately NOT
      // the two-beat step rhythm, so at a glance the robe reads as floating
      // rather than as walking under its skirt.
      bobM: 0.035 * stride * (0.5 + 0.5 * Math.sin(phase * TAU)),
      leanRad: 0.06 * stride * Math.sin(phase * TAU),
    };
  }
  if (archetypeId === 'orghon') {
    return { bobM: 0.030 * stride * (0.5 - 0.5 * c2), leanRad: 0.05 * stride * Math.sin(phase * TAU) };
  }
  // Bipeds: highest at mid-stance (c2 = -1 at phase .25/.75), lowest at
  // step-cross — the compass-gait shape, small enough to never read as a hop.
  return { bobM: 0.022 * stride * (0.5 - 0.5 * c2), leanRad: 0 };
}
