import { describe, expect, it } from 'vitest';
import { NET_TIMING, derivedIntervalMs, derivedDelayMs } from './netTiming.js';
import { MOVE_LIMITS } from '../sim/rules/moveRules.js';

describe('NET_TIMING', () => {
  // The two derived fields are stored as literals so hot paths never divide.
  // That is only safe while something recomputes them: a cadence edited from 20
  // to 30 leaves `snapshotIntervalMs: 50` looking entirely plausible, and every
  // interpolation would sample the wrong moment forever with no error anywhere.
  it('stores an interval that matches its own cadence', () => {
    expect(NET_TIMING.snapshotIntervalMs).toBe(derivedIntervalMs());
  });

  it('stores a delay that matches interval x intervals', () => {
    expect(NET_TIMING.interpolationDelayMs).toBe(derivedDelayMs());
  });

  it('delays by at least two intervals, so one lost snapshot is survivable', () => {
    // One interval of slack means a single missing snapshot is already an
    // underrun. Two is the smallest delay with any jitter budget at all.
    expect(NET_TIMING.delayIntervals).toBeGreaterThanOrEqual(2);
  });

  it('buffers more history than the render delay consumes', () => {
    // If capacity x interval only just covered the delay, the buffer would evict
    // snapshots the renderer had not reached yet — a stutter no interpolation
    // fix can reach, because the data is already gone.
    const historyMs = NET_TIMING.bufferCapacity * NET_TIMING.snapshotIntervalMs;
    expect(historyMs).toBeGreaterThan(NET_TIMING.interpolationDelayMs * 2);
  });

  it('sets the teleport threshold above anything the server would permit', () => {
    // The gate that matters: a threshold at or below the server's own ceiling
    // would classify ordinary clamped movement as a teleport and pop actors
    // during normal play.
    const serverCeilingMps = MOVE_LIMITS.maxSpeedMps * MOVE_LIMITS.toleranceMult;
    expect(NET_TIMING.teleportSpeedMps).toBeGreaterThan(serverCeilingMps);
  });
});
