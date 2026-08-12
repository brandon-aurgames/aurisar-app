/**
 * animState — the four named states, demoted to a parameter router.
 *
 * PURE. The generator (model/gait.js) consumes one continuous parameter
 * vector; this module owns the DISCRETE side: which state the actor is in
 * (gameplay needs names — P10's cast bar and P11's interrupts hang off them)
 * and how the parameter vector crossfades when the state changes. Blending
 * happens HERE, in parameter space, which is why no pose-blend code exists
 * anywhere: two clips cannot fight over a bone when there is only ever one
 * generator reading one blended vector.
 *
 * ─── Hysteresis and dwell, because remote speed is derived ───────────────────
 * A remote actor's speed comes from differencing interpolated positions, and
 * that signal JITTERS. A naive threshold strobes idle/run at the noise rate —
 * the flicker failure the P9 design pass named. THREE defenses: an EMA over
 * the incoming speed (τ = 250 ms — hysteresis alone measured 37 transitions
 * in 10 s against a signal oscillating across BOTH bands, because bands
 * cannot help when every sample clears them; the average can), a hysteresis
 * band on the SMOOTHED value, and a minimum dwell. Combat/cast are commanded
 * states, not inferred ones — they change on explicit request, so a cast can
 * always start instantly.
 */

export const ANIM_STATE = Object.freeze({
  IDLE: 'idle',
  RUN: 'run',
  COMBAT: 'combat',
  CAST: 'cast',
});

export const SPEED_ENTER_RUN_MPS = 0.5;
export const SPEED_EXIT_RUN_MPS = 0.2;
export const MIN_DWELL_MS = 250;
/** EMA time constant over incoming speed. See the header for the measured
 *  reason hysteresis alone was not enough. */
export const SPEED_EMA_TAU_MS = 250;
/** Parameter crossfade time. ~13 frames: long enough that a posture change
 *  never pops, short enough that combat feels commanded, not requested. */
export const BLEND_MS = 220;

const TARGETS = Object.freeze({
  idle: Object.freeze({ combatIntensity: 0, castCharge: 0 }),
  run: Object.freeze({ combatIntensity: 0, castCharge: 0 }),
  combat: Object.freeze({ combatIntensity: 1, castCharge: 0 }),
  // castCharge is NOT a constant 1: it ramps with cast progress (set by the
  // caller via castProgress), so the posture IS the cast bar.
  cast: Object.freeze({ combatIntensity: 0.4, castCharge: null }),
});

export function createAnimState() {
  return {
    state: ANIM_STATE.IDLE,
    enteredAtMs: -Infinity,
    castProgress: 0,
    // The live blended vector the generator reads. `speed` is the SMOOTHED
    // value — the generator's swing amplitude should breathe, not buzz.
    params: { speed: 0, combatIntensity: 0, castCharge: 0 },
    _speedEma: 0,
    _lastMs: null,
    // Where the vector is heading, and from where, for the crossfade.
    _from: { combatIntensity: 0, castCharge: 0 },
    _blendStartMs: -Infinity,
  };
}

function beginBlend(s, nowMs) {
  s._from = { combatIntensity: s.params.combatIntensity, castCharge: s.params.castCharge };
  s._blendStartMs = nowMs;
}

/** Request a commanded state (combat stance on/off, cast start/stop). Speed
 *  transitions are not requested — they are inferred in update(). */
export function requestState(s, state, nowMs) {
  if (state === s.state) return s.state;
  const dwelled = nowMs - s.enteredAtMs >= MIN_DWELL_MS;
  // Entering cast is always allowed (an interrupt that waits 250 ms is a
  // failed interrupt); everything else respects the dwell.
  if (state !== ANIM_STATE.CAST && !dwelled) return s.state;
  s.state = state;
  s.enteredAtMs = nowMs;
  if (state === ANIM_STATE.CAST) s.castProgress = 0;
  beginBlend(s, nowMs);
  return s.state;
}

/**
 * Per-frame: infer idle/run from speed (hysteresis + dwell), advance the
 * crossfade, emit the blended vector. `speedMps` may be noisy — that is the
 * whole design. Returns `s.params` (the same object, updated in place, so a
 * per-frame caller allocates nothing).
 */
export function updateAnimState(s, speedMps, nowMs) {
  const raw = Number.isFinite(speedMps) ? Math.max(0, speedMps) : 0;
  const dtMs = s._lastMs === null ? 0 : Math.max(0, nowMs - s._lastMs);
  s._lastMs = nowMs;
  // First sample seeds the EMA outright — a from-zero warmup would report a
  // sprinting newcomer as idle for the first half second.
  const alpha = dtMs === 0 ? 1 : 1 - Math.exp(-dtMs / SPEED_EMA_TAU_MS);
  s._speedEma += (raw - s._speedEma) * alpha;
  // The EMA is an exponential asymptote: after a stop it decays toward zero
  // and never arrives, so the odometer would creep phase (and the palette)
  // microscopically forever — a stopped actor that never quite freezes.
  // Below a centimetre per second nothing is moving; snap it.
  if (s._speedEma < 0.01) s._speedEma = 0;
  const speed = s._speedEma;

  // Locomotion inference only ever toggles idle<->run; commanded states keep
  // their name while still carrying the live speed through to the generator
  // (a combatant who walks still walks).
  if (s.state === ANIM_STATE.IDLE || s.state === ANIM_STATE.RUN) {
    const dwelled = nowMs - s.enteredAtMs >= MIN_DWELL_MS;
    if (dwelled) {
      if (s.state === ANIM_STATE.IDLE && speed > SPEED_ENTER_RUN_MPS) {
        s.state = ANIM_STATE.RUN;
        s.enteredAtMs = nowMs;
        beginBlend(s, nowMs);
      } else if (s.state === ANIM_STATE.RUN && speed < SPEED_EXIT_RUN_MPS) {
        s.state = ANIM_STATE.IDLE;
        s.enteredAtMs = nowMs;
        beginBlend(s, nowMs);
      }
    }
  }

  const target = TARGETS[s.state];
  const t = Math.min(Math.max((nowMs - s._blendStartMs) / BLEND_MS, 0), 1);
  const castTarget = target.castCharge === null ? s.castProgress : target.castCharge;
  s.params.speed = speed;
  s.params.combatIntensity = s._from.combatIntensity
    + (target.combatIntensity - s._from.combatIntensity) * t;
  s.params.castCharge = s._from.castCharge + (castTarget - s._from.castCharge) * t;
  return s.params;
}
