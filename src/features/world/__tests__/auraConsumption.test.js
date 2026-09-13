/**
 * M9-6 — aura CONSUMPTION (buffs, shields, control).
 *
 * M6-4 shipped the half that PLACES auras: the resolver emits them, the
 * reducer persists them, `tickAuras` ticks and expires them. Nothing read them
 * back, so a 50% slow did not slow anyone, a 25 HP shield stopped no damage
 * and a +10 attack-power buff changed no number. These are the pure helpers
 * that close that, tested here for the same reason `moveGuard.test.js` exists:
 * `spacetimedb/src/index.ts` calls `schema({...})` at load and cannot be
 * imported outside a SpacetimeDB host, but the arithmetic can.
 */
import { describe, expect, it } from 'vitest';
import {
  auraStatBonuses,
  buffedAttributes,
  consumeAbsorb,
  movementRestriction,
  slowMultiplier,
} from '../../../../spacetimedb/src/combat/auras.ts';
import { clampMoveToMaxSpeed } from '../../../../spacetimedb/src/world/moveGuard.ts';
import { deriveStats } from '../content/formulas/combat.ts';
import { PX_PER_M } from '../worldSpace.js';

const NOW = 1_000_000n;
const LIVE = NOW + 10_000_000n; // expires well after NOW
const DEAD = NOW - 1n;          // already expired, not yet swept

let nextId = 1n;
function aura(effectKind, over = {}) {
  return {
    id: nextId++,
    abilityId: 'test_ability',
    effectKind,
    stat: '',
    magnitude: 0,
    expiresAt: LIVE,
    nextTickAt: 0n,
    tickSec: 0,
    ...over,
  };
}

describe('auraStatBonuses', () => {
  it('splits the three stat families apart', () => {
    const b = auraStatBonuses(
      [
        aura('selfBuff', { stat: 'attackPower', magnitude: 10 }),
        aura('buffTarget', { stat: 'attackPower', magnitude: 8 }),
        aura('selfBuff', { stat: 'armor', magnitude: 60 }),
        aura('selfBuff', { stat: 'STR', magnitude: 3 }),
      ],
      NOW,
    );
    expect(b.attackPower).toBe(18);
    expect(b.armor).toBe(60);
    expect(b.attrs).toEqual({ STR: 3 });
  });

  it('ignores non-buff kinds and anything already expired', () => {
    const b = auraStatBonuses(
      [
        aura('dot', { magnitude: 99 }),
        aura('slow', { magnitude: 50 }),
        aura('selfBuff', { stat: 'attackPower', magnitude: 40, expiresAt: DEAD }),
      ],
      NOW,
    );
    expect(b).toEqual({ attrs: {}, armor: 0, attackPower: 0 });
  });

  it('drops a stat name this build has no mapping for', () => {
    // Better a silent no-op than a guess: content could name anything.
    const b = auraStatBonuses([aura('selfBuff', { stat: 'haste', magnitude: 5 })], NOW);
    expect(b).toEqual({ attrs: {}, armor: 0, attackPower: 0 });
  });
});

describe('buffedAttributes', () => {
  const KIT = { baseHp: 100, hpPerLevel: 10, baseResource: 50, resourcePerLevel: 5 };

  it('makes +N attackPower EXACTLY +N attackPower in DerivedStats', () => {
    // The whole reason the fold is legal: attackPower = round(STR + DEX) and
    // STR feeds nothing else. If deriveStats ever gives STR a second job, this
    // fails and the fold has to be revisited.
    const base = { STR: 5, DEX: 7, CON: 4, VIT: 2, INT: 3, WIS: 1 };
    const plain = deriveStats(base, 10, KIT);
    const buffed = deriveStats(
      buffedAttributes(base, { attrs: {}, armor: 0, attackPower: 10 }),
      10,
      KIT,
    );
    expect(buffed.attackPower).toBe(plain.attackPower + 10);
    // and NOTHING else moved
    expect(buffed.maxHp).toBe(plain.maxHp);
    expect(buffed.critChance).toBe(plain.critChance);
    expect(buffed.maxResource).toBe(plain.maxResource);
    expect(buffed.baseArmor).toBe(plain.baseArmor);
  });

  it('folds attackPower into STR, never DEX (DEX also drives crit)', () => {
    const out = buffedAttributes({ STR: 1, DEX: 1 }, { attrs: {}, armor: 0, attackPower: 4 });
    expect(out).toEqual({ STR: 5, DEX: 1 });
  });

  it('leaves armor alone - CON drives maxHp as well as baseArmor', () => {
    const out = buffedAttributes({ CON: 10 }, { attrs: {}, armor: 60, attackPower: 0 });
    expect(out).toEqual({ CON: 10 });
  });

  it('adds attribute deltas on top of the gear block without mutating it', () => {
    const base = { STR: 2 };
    const out = buffedAttributes(base, { attrs: { STR: 3, INT: 4 }, armor: 0, attackPower: 0 });
    expect(out).toEqual({ STR: 5, INT: 4 });
    expect(base).toEqual({ STR: 2 });
  });
});

describe('movementRestriction', () => {
  it('blocks on a stun or a root', () => {
    expect(movementRestriction([aura('stun')], NOW).blocked).toBe(true);
    expect(movementRestriction([aura('root')], NOW).blocked).toBe(true);
  });

  it('converts the stored PERCENT, not a fraction', () => {
    // The trap combat/auras.ts warns about: magnitude 50 means half speed, so
    // the multiplier is 0.5 - not 50, and not 0.995.
    const r = movementRestriction([aura('slow', { magnitude: 50 })], NOW);
    expect(r.blocked).toBe(false);
    expect(r.speedMultiplier).toBe(0.5);
    expect(r.speedMultiplier).toBe(slowMultiplier(50));
  });

  it('takes the strongest slow rather than stacking them', () => {
    // Two ordinary 50% slows multiplying to 0.25 would be a de-facto root.
    const r = movementRestriction(
      [aura('slow', { magnitude: 50 }), aura('slow', { magnitude: 30 })],
      NOW,
    );
    expect(r.speedMultiplier).toBe(0.5);
  });

  it('ignores an expired stun the 1 Hz sweep has not deleted yet', () => {
    const r = movementRestriction([aura('stun', { expiresAt: DEAD })], NOW);
    expect(r).toEqual({ blocked: false, speedMultiplier: 1 });
  });

  it('is unimpaired when nothing applies', () => {
    expect(movementRestriction([aura('dot', { magnitude: 9 })], NOW))
      .toEqual({ blocked: false, speedMultiplier: 1 });
  });
});

describe('clampMoveToMaxSpeed under a slow', () => {
  // 80 ms of walking at full tilt is 0.96 m - accepted unslowed (moveGuard.test.js).
  const step = 0.96 * PX_PER_M;

  it('accepts the same step unslowed and cuts it under a 50% slow', () => {
    expect(clampMoveToMaxSpeed(0, 0, step, 0, 80_000n, 1).clamped).toBe(false);
    const slowed = clampMoveToMaxSpeed(0, 0, step, 0, 80_000n, slowMultiplier(50));
    expect(slowed.clamped).toBe(true);
    expect(slowed.x).toBeLessThan(step);
  });

  it('scales the whole allowance by the multiplier', () => {
    const free = clampMoveToMaxSpeed(0, 0, 1e9, 0, 1_000_000n, 1).x;
    const half = clampMoveToMaxSpeed(0, 0, 1e9, 0, 1_000_000n, 0.5).x;
    expect(half).toBeCloseTo(free * 0.5, 6);
  });

  it('treats a missing or nonsensical multiplier as unimpaired', () => {
    const free = clampMoveToMaxSpeed(0, 0, 1e9, 0, 1_000_000n).x;
    expect(clampMoveToMaxSpeed(0, 0, 1e9, 0, 1_000_000n, 0).x).toBe(free);
    expect(clampMoveToMaxSpeed(0, 0, 1e9, 0, 1_000_000n, -1).x).toBe(free);
    expect(clampMoveToMaxSpeed(0, 0, 1e9, 0, 1_000_000n, NaN).x).toBe(free);
  });
});

describe('consumeAbsorb', () => {
  it('eats the whole hit and leaves the pool standing', () => {
    const shield = aura('absorb', { magnitude: 25, abilityId: 'oracle_ward' });
    const r = consumeAbsorb([shield], 10, NOW);
    expect(r.absorbed).toBe(10);
    expect(r.remaining).toBe(0);
    expect(r.absorbedBy).toBe('oracle_ward');
    expect(r.drained).toEqual([{ row: shield, magnitude: 15 }]);
    expect(r.spent).toEqual([]);
  });

  it('spends the pool and passes the overflow through to hp', () => {
    const shield = aura('absorb', { magnitude: 25 });
    const r = consumeAbsorb([shield], 40, NOW);
    expect(r.absorbed).toBe(25);
    expect(r.remaining).toBe(15);
    expect(r.spent).toEqual([shield]);
    expect(r.drained).toEqual([]);
  });

  it('deletes an exactly-drained pool rather than leaving an f32 sliver', () => {
    const shield = aura('absorb', { magnitude: 25 });
    const r = consumeAbsorb([shield], 25, NOW);
    expect(r.remaining).toBe(0);
    expect(r.spent).toEqual([shield]);
  });

  it('spends the soonest-expiring shield first', () => {
    const soon = aura('absorb', { magnitude: 10, expiresAt: NOW + 1_000_000n, abilityId: 'soon' });
    const later = aura('absorb', { magnitude: 10, expiresAt: NOW + 9_000_000n, abilityId: 'later' });
    const r = consumeAbsorb([later, soon], 12, NOW);
    expect(r.absorbedBy).toBe('soon');
    expect(r.spent).toEqual([soon]);
    expect(r.drained).toEqual([{ row: later, magnitude: 8 }]);
    expect(r.remaining).toBe(0);
  });

  it('ignores expired shields and non-absorb auras', () => {
    const r = consumeAbsorb(
      [aura('absorb', { magnitude: 99, expiresAt: DEAD }), aura('hot', { magnitude: 99 })],
      10,
      NOW,
    );
    expect(r.absorbed).toBe(0);
    expect(r.remaining).toBe(10);
    expect(r.absorbedBy).toBe('');
  });

  it('is a no-op on a zero or negative hit', () => {
    const shield = aura('absorb', { magnitude: 25 });
    expect(consumeAbsorb([shield], 0, NOW)).toMatchObject({ absorbed: 0, remaining: 0 });
    expect(consumeAbsorb([shield], -5, NOW)).toMatchObject({ absorbed: 0, remaining: 0 });
    expect(shield.magnitude).toBe(25); // pure: nothing was written
  });
});
