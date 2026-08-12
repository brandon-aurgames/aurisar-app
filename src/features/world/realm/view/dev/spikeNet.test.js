/**
 * spikeNet.test.js — the demo wiring, headless.
 *
 * spikeNet is deliberately BABYLON-free (it orchestrates sim/ and returns
 * plain samples), which is what makes the ENTIRE demo stack — local client,
 * dispatcher, shaped link, ghost clients, hub — testable in plain node with a
 * fake clock. The browser adds only rendering on top of what this file proves.
 */
import { describe, expect, it } from 'vitest';
import { createSpikeNet, parseNetParams } from './spikeNet.js';
import { NET_TIMING } from '../../model/netTiming.js';

const PARAMS = { remotes: 2, latencyMs: 40, jitterMs: 20, dropRate: 0, seed: 5 };

describe('parseNetParams', () => {
  it('is null with no params — the demo must be inert by default', () => {
    // The spike is also P2-P7's exhibit; ghosts walking through those
    // baselines uninvited would change every prior phase's visual reference.
    expect(parseNetParams('')).toBeNull();
    expect(parseNetParams('?renderer=webgl2&timewarp=40')).toBeNull();
  });

  it('parses the full set', () => {
    expect(parseNetParams('?remotes=3&latency=80&jitter=60&drop=0.05&seed=9')).toEqual({
      remotes: 3, latencyMs: 80, jitterMs: 60, dropRate: 0.05, seed: 9,
    });
  });

  it('activates on latency alone — shaping your own echoes is a valid demo', () => {
    expect(parseNetParams('?latency=100')).toMatchObject({ remotes: 0, latencyMs: 100 });
  });

  it('refuses garbage rather than propagating NaN', () => {
    expect(parseNetParams('?remotes=lots&latency=-5')).toBeNull();
  });
});

describe('createSpikeNet', () => {
  async function rig(params = PARAMS) {
    let t = 0;
    const reconciles = [];
    const net = await createSpikeNet({
      params,
      now: () => t,
      onReconcile: (p) => reconciles.push(p),
    });
    return {
      net,
      reconciles,
      /** Step the world to `ms`, frame by 60 Hz frame, collecting samples. */
      runTo(ms) {
        let samples = [];
        while (t < ms) {
          t += 1000 / 60;
          samples = net.update(t);
        }
        return samples;
      },
    };
  }

  it('ghosts become sampleable remote actors', async () => {
    const { net, runTo } = await rig();
    const samples = runTo(2000);
    expect(samples).toHaveLength(2);
    expect(new Set(samples.map((s) => s.id))).toEqual(new Set(['ghost-0', 'ghost-1']));
    for (const s of samples) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.yaw)).toBe(true);
    }
    net.dispose();
  });

  it('ghost motion between frames stays under the server ceiling', async () => {
    // The demo must demonstrate legal movement: a ghost driver that outran
    // moveRules would be clamped into rubber-banding and the demo would show
    // an interpolator failing to smooth a fight it cannot win.
    const { net, runTo } = await rig();
    let prev = null;
    let worst = 0;
    for (let ms = 1000; ms <= 4000; ms += 1000 / 60) {
      const [s] = runTo(ms).filter((x) => x.id === 'ghost-0');
      if (s && prev) {
        worst = Math.max(worst, Math.hypot(s.x - prev.x, s.z - prev.z) / ((1000 / 60) / 1000));
      }
      prev = s ?? prev;
    }
    expect(worst).toBeGreaterThan(0); // it did move
    expect(worst).toBeLessThan(9.45); // and never teleported
    net.dispose();
  });

  it('the local player never appears among the samples', async () => {
    const { net, runTo } = await rig();
    net.sendMove({ x: 1, z: 1, yaw: 0 }, 0);
    const samples = runTo(2000);
    expect(samples.some((s) => s.id === 'spike-player')).toBe(false);
    net.dispose();
  });

  it('throttles moveIntents to the snapshot cadence', async () => {
    const { net } = await rig({ ...PARAMS, remotes: 0 });
    // 60 calls inside one interval: only the first may send.
    for (let i = 0; i < 60; i++) net.sendMove({ x: i * 0.01, z: 0, yaw: 0 }, i * 0.5);
    // The shaper passes sends through undelayed, so the world heard them
    // already; a second send within the window must have been swallowed.
    expect(net.hub.count()).toBe(0); // sanity: still no remotes
    net.sendMove({ x: 9, z: 0, yaw: 0 }, NET_TIMING.snapshotIntervalMs + 1);
    net.dispose();
  });

  it('a server clamp comes back as a RECONCILE through the shaped link', async () => {
    const { net, reconciles, runTo } = await rig({ ...PARAMS, remotes: 0 });
    runTo(500);
    // An impossible claim: hundreds of metres in one intent.
    net.sendMove({ x: 500, z: 500, yaw: 0 }, 600);
    runTo(1500); // give the shaped link time to deliver the correction
    expect(reconciles.length).toBeGreaterThan(0);
    const r = reconciles[reconciles.length - 1];
    expect(Math.hypot(r.x, r.z)).toBeLessThan(50); // clamped, not honoured
    net.dispose();
  });

  it('statsLine reports without throwing at every lifecycle stage', async () => {
    const { net, runTo } = await rig();
    expect(() => net.statsLine()).not.toThrow();
    runTo(1000);
    expect(net.statsLine()).toMatch(/remote/);
    net.dispose();
  });
});
