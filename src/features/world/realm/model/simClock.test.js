import { describe, expect, it } from 'vitest';
import { createSimClock, SIM_STEP_MS, MAX_CATCH_UP_MS } from './simClock.js';

describe('createSimClock', () => {
  it('owes nothing on the first advance', () => {
    // The first call establishes the time origin. Without this, a clock handed
    // performance.now() (or a Date.now()-scale number) on frame one would owe
    // every step since the epoch and immediately run the spiral guard's budget.
    const clock = createSimClock();
    expect(clock.advance(1_000_000)).toBe(0);
    expect(clock.tick()).toBe(0);
  });

  it('runs one step per step-length of elapsed time', () => {
    const clock = createSimClock();
    clock.advance(0);
    expect(clock.advance(17)).toBe(1);
    expect(clock.advance(34)).toBe(1);
    expect(clock.tick()).toBe(2);
  });

  it('conserves elapsed time across many frames', () => {
    // The property that actually matters, and the reason the assertions here
    // avoid exact step multiples: 3 x 16.666... rounds to exactly 50, and
    // 50 - step - step lands one ulp BELOW step, so the third step arrives on
    // the following frame instead. No time is lost; only the frame it lands on
    // moves. A test asserting "3 steps" there would be a coin flip on the ulp.
    const clock = createSimClock();
    clock.advance(0);
    let t = 0;
    for (let i = 0; i < 200; i++) { t += 7; clock.advance(t); }
    const simulatedMs = (clock.tick() + clock.alpha()) * SIM_STEP_MS;
    expect(simulatedMs).toBeCloseTo(t, 9);
  });

  it('accumulates sub-step deltas instead of dropping them', () => {
    // A 144 Hz display delivers ~6.94 ms frames against a 16.67 ms step. If
    // remainders were discarded the simulation would run permanently slow.
    const clock = createSimClock();
    clock.advance(0);
    expect(clock.advance(6.94)).toBe(0);
    expect(clock.advance(13.88)).toBe(0);
    expect(clock.advance(20.82)).toBe(1);
  });

  it('reports the residual phase as alpha in [0, 1)', () => {
    const clock = createSimClock();
    clock.advance(0);
    clock.advance(SIM_STEP_MS / 2);
    expect(clock.alpha()).toBeCloseTo(0.5, 10);

    clock.advance(SIM_STEP_MS);
    expect(clock.alpha()).toBeGreaterThanOrEqual(0);
    expect(clock.alpha()).toBeLessThan(1);
  });

  it('clamps a long stall to the catch-up budget', () => {
    // Two minutes away owes ~7,200 steps. Running them costs more than a frame,
    // which grows the next delta, which owes more steps: the spiral. The clamp
    // loses the stall on purpose — the server is authoritative about position.
    const clock = createSimClock();
    clock.advance(0);
    const steps = clock.advance(120_000);
    // 250 ms is exactly 15 steps at 60 Hz (250 = 15 x 50/3), not the 7,200 the
    // stall owed. Note the budget is asserted as a property too: writing the
    // expectation as `Math.floor(MAX_CATCH_UP_MS / SIM_STEP_MS)` computes 14,
    // because that divide rounds down — the test would then be asserting the
    // float artefact rather than the clamp.
    expect(steps).toBe(15);
    expect(steps * SIM_STEP_MS).toBeLessThanOrEqual(MAX_CATCH_UP_MS + 1e-9);
  });

  it('does not spiral on the advance after a stall', () => {
    // The guard has to leave the accumulator drained. Bailing mid-loop instead
    // would leave it full, and the next frame would owe the budget all over
    // again — a spiral guard that merely defers the spiral.
    const clock = createSimClock();
    clock.advance(0);
    clock.advance(120_000);
    expect(clock.advance(120_000 + SIM_STEP_MS)).toBe(1);
  });

  it('ignores a backwards clock rather than stalling on it', () => {
    // A negative delta would drive the accumulator below zero and freeze the
    // simulation until real time caught back up to the old high-water mark.
    const clock = createSimClock();
    clock.advance(0);
    clock.advance(100);
    expect(clock.advance(50)).toBe(0);
    // And time measured from the rewound point still works.
    expect(clock.advance(50 + SIM_STEP_MS * 2)).toBe(2);
  });

  it('ignores a non-finite now', () => {
    const clock = createSimClock();
    clock.advance(0);
    expect(clock.advance(Number.NaN)).toBe(0);
    expect(clock.advance(SIM_STEP_MS)).toBe(1);
  });

  it('resume re-origins without losing the tick count', () => {
    const clock = createSimClock();
    clock.advance(0);
    clock.advance(60); // 3.6 steps — safely past three, not sitting on the edge
    expect(clock.tick()).toBe(3);

    clock.resume();
    // The gap across the resume is not owed...
    expect(clock.advance(9_999_999)).toBe(0);
    // ...but the count survives, so anything keyed on tick stays continuous.
    expect(clock.tick()).toBe(3);
    // 105 ms is six steps and change. Deliberately not an exact multiple of the
    // step: at this magnitude a double's ulp is enough to land a boundary-exact
    // delta on either side, which would make the assertion a coin flip rather
    // than a statement about the clock.
    expect(clock.advance(9_999_999 + 105)).toBe(6);
    expect(clock.tick()).toBe(9);
  });

  it('rejects a non-positive step rather than looping forever', () => {
    // floor(anything / 0) is Infinity: the caller's step loop would never end.
    expect(() => createSimClock({ stepMs: 0 })).toThrow(/positive/);
  });
});
