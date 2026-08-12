import { describe, expect, it } from 'vitest';
import { createPlayoutClock } from './playoutClock.js';
import { NET_TIMING } from '../model/netTiming.js';

/** Feed n arrivals of a stream stamped at `hz`, each delayed by `delayFor(i)`. */
function feed(clock, { n, hz = NET_TIMING.snapshotHz, delayFor = () => 0, startT = 0 }) {
  const interval = 1000 / hz;
  for (let i = 0; i < n; i++) {
    const stamp = startT + i * interval;
    clock.observe(stamp + delayFor(i), stamp);
  }
}

describe('createPlayoutClock', () => {
  it('has no opinion before it has seen anything', () => {
    // Guessing zero would place render time a whole latency ahead of anything
    // received, reporting a permanent underrun on the first frames.
    const clock = createPlayoutClock();
    expect(clock.offset()).toBeNull();
    expect(clock.renderTimeAt(1000)).toBeNull();
  });

  it('takes the first reading whole', () => {
    const clock = createPlayoutClock();
    clock.observe(1080, 1000);
    expect(clock.offset()).toBe(80);
  });

  it('ignores non-finite readings', () => {
    const clock = createPlayoutClock();
    clock.observe(1080, 1000);
    clock.observe(Number.NaN, 1000);
    clock.observe(1080, undefined);
    expect(clock.offset()).toBe(80);
    expect(clock.observationCount()).toBe(1);
  });

  it('slews down to a better estimate instead of stepping to it', () => {
    // THE bug this module was rewritten for. Render time is
    // `now - offset - delay`, so an instant drop teleports render time forward:
    // measured on the 60 ms-jitter profile, one unusually fast packet moved the
    // actor 0.25 m in a single frame (14.8 m/s), and every discontinuity the
    // exit bar forbade was coming from here rather than from the interpolator.
    const clock = createPlayoutClock();
    clock.observe(1100, 1000); // offset 100
    clock.observe(2000, 2000); // offset 0 would be a 100 ms step
    expect(clock.offset()).toBeGreaterThan(99);
    expect(clock.offset()).toBeLessThan(100);
  });

  it('still converges on the true offset given time', () => {
    // Slewing must not mean never arriving: a genuine 100 ms improvement should
    // be tracked within a few seconds at 20 Hz.
    const clock = createPlayoutClock();
    clock.observe(1100, 1000);
    feed(clock, { n: 400, startT: 2000 });
    expect(clock.offset()).toBeLessThan(1);
  });

  it('holds against worse readings while the fast packet is in the window', () => {
    // The estimate is a windowed minimum, so a run of slow packets does not
    // move it at all — they are jitter, not a new truth — for as long as one
    // fast reading remains in the window.
    const clock = createPlayoutClock();
    clock.observe(1000, 1000); // offset 0
    for (let i = 0; i < 5; i++) clock.observe(2000 + i * 50 + 200, 2000 + i * 50);
    expect(clock.offset()).toBe(0);
  });

  it('steps up to a genuinely worse link once the fast packet ages out', () => {
    // The other half of window semantics, stated honestly: when the reading
    // that set the minimum leaves the window, the estimate jumps to the new
    // minimum in ONE observation — there is no gradual rise. The jump pushes
    // render time backwards, which the monotonic renderTimeAt guard absorbs,
    // so the correction never reaches the screen as motion (asserted by the
    // burst test below).
    const clock = createPlayoutClock({ windowSamples: 10 });
    clock.observe(1000, 1000); // offset 0, the packet that sets the minimum
    for (let i = 1; i <= 9; i++) clock.observe(1000 + i * 50 + 200, 1000 + i * 50);
    expect(clock.offset()).toBe(0); // still in the window
    clock.observe(1000 + 10 * 50 + 200, 1000 + 10 * 50); // evicts it
    expect(clock.offset()).toBe(200);
  });

  it('keeps the delay at the floor on a clean link', () => {
    const clock = createPlayoutClock();
    feed(clock, { n: 100, delayFor: () => 40 }); // constant latency, zero jitter
    expect(clock.delayMs()).toBeCloseTo(NET_TIMING.interpolationDelayMs, 6);
    expect(clock.jitterMs()).toBeLessThan(1);
  });

  it('grows the delay to cover measured jitter', () => {
    // A link whose jitter exceeds the fixed floor underruns structurally, no
    // matter how good the interpolator is — measured at 17% of frames on the
    // 120 ms mobile profile before the delay adapted.
    const clock = createPlayoutClock();
    feed(clock, { n: 300, delayFor: (i) => 40 + (i % 7) * 30 }); // up to 180 ms spread
    expect(clock.delayMs()).toBeGreaterThan(NET_TIMING.interpolationDelayMs);
    expect(clock.jitterMs()).toBeGreaterThan(100);
  });

  it('never drops the delay below the floor', () => {
    const clock = createPlayoutClock();
    feed(clock, { n: 500, delayFor: () => 5 });
    expect(clock.delayMs()).toBeGreaterThanOrEqual(NET_TIMING.interpolationDelayMs);
  });

  it('never grows the delay past what the buffer can hold', () => {
    // The buffer keeps capacity x interval of history. A delay pushed past
    // that samples at server moments already evicted, so the sampler pins to
    // the oldest snapshot it has — WARMUP forever, a frozen actor. Past this
    // ceiling, worse jitter is a link the interpolator cannot save.
    const clock = createPlayoutClock();
    // Pathological spread: 0-600 ms of jitter, far beyond any profile.
    feed(clock, { n: 1000, delayFor: (i) => 40 + (i % 13) * 50 });
    const ceiling = (NET_TIMING.bufferCapacity - 1) * NET_TIMING.snapshotIntervalMs;
    expect(clock.delayMs()).toBeLessThanOrEqual(ceiling);
    expect(clock.jitterMs()).toBeGreaterThan(ceiling); // the clamp actually bit
  });

  it('never moves render time backwards, even on a burst', () => {
    // The guarantee that matters. A stalled tab delivering its whole backlog
    // inside one frame can grow the delay faster than the frame advanced, and
    // a backwards render time makes the actor moonwalk — the exact
    // discontinuity the delay exists to prevent.
    const clock = createPlayoutClock();
    feed(clock, { n: 40, delayFor: () => 30 });

    let now = 3000;
    let last = clock.renderTimeAt(now);
    for (let frame = 0; frame < 400; frame++) {
      now += 1000 / 60;
      // A pathological burst: twenty wildly-late arrivals inside one frame.
      if (frame % 50 === 0) {
        for (let i = 0; i < 20; i++) clock.observe(now, now - 400 - i * 10);
      }
      const rt = clock.renderTimeAt(now);
      expect(rt, `render time went backwards on frame ${frame}`).toBeGreaterThanOrEqual(last);
      last = rt;
    }
  });

  it('renders in the past, never in the future', () => {
    const clock = createPlayoutClock();
    feed(clock, { n: 100, delayFor: () => 60 });
    const now = 10_000;
    expect(clock.renderTimeAt(now)).toBeLessThan(now);
  });

  it('absorbs base latency so the delay is spent on jitter alone', () => {
    // Two links with identical jitter but very different latency must end up
    // with the same delay — that is the whole point of estimating the offset.
    const quiet = createPlayoutClock();
    const distant = createPlayoutClock();
    feed(quiet, { n: 200, delayFor: (i) => 10 + (i % 3) * 10 });
    feed(distant, { n: 200, delayFor: (i) => 300 + (i % 3) * 10 });
    expect(distant.delayMs()).toBeCloseTo(quiet.delayMs(), 6);
  });

  it('resyncs after a frozen-tab resume instead of unwinding for minutes', () => {
    // The field scenario, reproduced live in the hidden browser pane before
    // this path existed: a freeze flushes its backlog on resume with stale
    // stamps, the windowed minimum ratchets up seconds high, and the
    // 0.5 ms/observation slew needs ~8 minutes to unwind 13 s of error — 86%
    // of frames pinned to WARMUP the whole way. Past the resync gap the clock
    // must step down at once.
    const clock = createPlayoutClock();
    feed(clock, { n: 100, delayFor: () => 40 }); // healthy link, offset ~40
    // The frozen-resume backlog: every reading in the window becomes ~13 s.
    feed(clock, { n: 100, startT: 5000, delayFor: () => 13_000 });
    expect(clock.offset()).toBeGreaterThan(10_000); // the poison took

    // Fresh packets resume. Within one snapshot of readings — not minutes —
    // the estimate must be back at the truth.
    feed(clock, { n: 5, startT: 25_000, delayFor: () => 40 });
    expect(clock.offset()).toBeLessThan(100);
  });

  it('a resync also purges the dead timeline from the jitter estimate', () => {
    // Without the purge, the 13 s spread sits in the window for another 80
    // observations pinning the delay at its clamp — four more seconds of
    // maximum lag on a link that is already healthy again.
    const clock = createPlayoutClock();
    feed(clock, { n: 100, delayFor: () => 40 });
    feed(clock, { n: 100, startT: 5000, delayFor: () => 13_000 });
    feed(clock, { n: 10, startT: 25_000, delayFor: (i) => 40 + (i % 3) * 10 });
    expect(clock.jitterMs()).toBeLessThan(100);
  });

  it('does NOT resync inside the gap — ordinary bad links still slew', () => {
    // The boundary matters: a genuine 400 ms route change is jitter territory
    // and must keep the smooth path, or every route change becomes a snap.
    const clock = createPlayoutClock();
    feed(clock, { n: 100, delayFor: () => 500 }); // offset ~500
    feed(clock, { n: 3, startT: 5000, delayFor: () => 40 });
    // Slewing: barely moved after 3 observations, no step.
    expect(clock.offset()).toBeGreaterThan(490);
  });

  it('forgets its estimate on reset', () => {
    const clock = createPlayoutClock();
    feed(clock, { n: 50, delayFor: (i) => 40 + (i % 5) * 40 });
    clock.reset();
    expect(clock.offset()).toBeNull();
    expect(clock.jitterMs()).toBe(0);
    expect(clock.delayMs()).toBe(NET_TIMING.interpolationDelayMs);
    expect(clock.renderTimeAt(5000)).toBeNull();
  });
});
