import { describe, expect, it } from 'vitest';
import { ABILITIES, ALL_ABILITIES, CLASS_KITS } from '../classes';
import { ITEMS } from '../items';
import { MOBS } from '../zones/zone1/mobs';
import type { AbilityDef, AbilityEffect, ClassId } from '../types';
import { CRIT_MULT, deriveStats, GCD_SEC, GCD_SEC_ENERGY, mulberry32, resolvePhysicalHit } from '../formulas/combat';
import { rankFor, resolveCast, validateCast } from '../formulas/abilityResolve';
import type { CasterState, CastRejection, ResolvedEffect, TargetState } from '../formulas/abilityResolve';

const NOW = 10_000_000n;
const STRIKE = ABILITIES.warrior_heroic_strike;
const starter = ITEMS.worn_shortsword.gameStats!;
const weapon = {
  dmgMin: starter.weaponDmgMin!, dmgMax: starter.weaponDmgMax!, speedSec: starter.weaponSpeedSec!,
};
function caster(classId: ClassId = 'warrior', level = 1): CasterState {
  const stats = deriveStats({}, level, CLASS_KITS[classId]);
  return {
    classId, level, attrs: {}, resource: stats.maxResource,
    hp: stats.maxHp, maxHp: stats.maxHp, weapon: { ...weapon },
    cooldownsMicros: {}, lastGcdAtMicros: 0n,
  };
}
const target: TargetState = { level: 1, hp: 100, maxHp: 100, armor: 0 };
function damage(effects: ResolvedEffect[]): number {
  return effects.reduce((sum, e) => sum + (e.kind === 'damage' ? e.amount : 0), 0);
}
const ALL_REJECTIONS = [
  'unknownAbility', 'wrongClass', 'levelTooLow', 'outOfRange', 'onCooldown',
  'onGcd', 'noResource', 'noTarget', 'targetDead', 'casterDead',
] as const satisfies readonly CastRejection[];

describe('Canonical ability resolver', () => {
  it('EveryAbilityResolvesToAtLeastOneEffect', () => {
    expect(ALL_ABILITIES).toHaveLength(22);
    for (const def of ALL_ABILITIES) {
      const state = caster(def.classId, def.minLevel);
      const recipient = def.rangeM > 0 ? target : null;
      expect(validateCast(def, state, recipient, def.rangeM, NOW), def.id).toBeNull();
      const result = resolveCast(mulberry32(7), def, state, recipient, NOW);
      expect(result.effects.length, def.id).toBeGreaterThan(0);
      expect(result.effects, def.id).toHaveLength(def.effects.length);
      expect(result.resourceSpent).toBe(rankFor(def, state.level).cost);
      expect(result.cooldownUntilMicros).toBe(NOW + BigInt(def.cooldownSec * 1_000_000));
    }
  });

  it('EveryEffectKindIsHandled', () => {
    // Record makes all twelve union members mandatory, including the three unused in kits.
    const fixtures = {
      weaponStrike: { kind: 'weaponStrike', bonusDamage: 6 },
      directDamage: { kind: 'directDamage', min: 10, max: 10 },
      aoeDamage: { kind: 'aoeDamage', min: 10, max: 10, radiusM: 5 },
      heal: { kind: 'heal', min: 10, max: 10 },
      dot: { kind: 'dot', totalDamage: 30, durationSec: 6, tickSec: 2 },
      hot: { kind: 'hot', totalHeal: 30, durationSec: 6, tickSec: 2 },
      absorb: { kind: 'absorb', amount: 10, durationSec: 6 },
      selfBuff: { kind: 'selfBuff', stat: 'STR', amount: 10, durationSec: 6 },
      buffTarget: { kind: 'buffTarget', stat: 'armor', amount: 10, durationSec: 6 },
      stun: { kind: 'stun', durationSec: 6 },
      root: { kind: 'root', durationSec: 6 },
      slow: { kind: 'slow', pct: 0.25, durationSec: 6 },
    } satisfies Record<AbilityEffect['kind'], AbilityEffect>;
    const aura = (effectKind: AbilityEffect['kind'], magnitude: number, tickSec = 0,
      onSelf = false, stat?: string): ResolvedEffect => ({
      kind: 'aura', effectKind, onSelf, magnitude, durationSec: 6, tickSec,
      ...(stat ? { stat } : {}),
    });
    const expected: Record<AbilityEffect['kind'], ResolvedEffect> = {
      weaponStrike: { kind: 'damage', amount: 17, hit: 'hit' },
      directDamage: { kind: 'damage', amount: 20, hit: 'hit' },
      aoeDamage: { kind: 'damage', amount: 20, hit: 'hit' },
      heal: { kind: 'heal', amount: 20 },
      dot: aura('dot', 20, 2), hot: aura('hot', 20, 2), absorb: aura('absorb', 20),
      selfBuff: aura('selfBuff', 20, 0, true, 'STR'),
      buffTarget: aura('buffTarget', 20, 0, false, 'armor'),
      stun: aura('stun', 0), root: aura('root', 0), slow: aura('slow', 0.5),
    };
    expect(Object.keys(fixtures)).toHaveLength(12);
    for (const effect of Object.values(fixtures)) {
      const def = { ...STRIKE, effects: [effect], ranks: [{ level: 1, magnitudeMult: 2 }] };
      expect(resolveCast(() => 0.5, def, caster(), target, NOW).effects).toEqual([expected[effect.kind]]);
    }
    const unknown = { ...STRIKE, effects: [{ kind: 'futureEffect' } as unknown as AbilityEffect] };
    expect(() => resolveCast(() => 0.5, unknown, caster(), target, NOW)).toThrow('Unknown ability effect kind');
  });

  it('RanksScaleMagnitudes', () => {
    // Isolate the ranked flat bonus: weapon damage/AP are not rank-scaled (§2.1).
    // Equal-level targets keep the hit table identical across the 1,000 seeded rolls.
    const levels = [1, 8, 16];
    const means = levels.map(level => {
      const state = { ...caster('warrior', level), weapon: { dmgMin: 0, dmgMax: 0, speedSec: 2.4 } };
      const rng = mulberry32(81);
      let total = 0;
      for (let roll = 0; roll < 1_000; roll++) {
        total += damage(resolveCast(rng, STRIKE, state, { ...target, level }, NOW).effects);
      }
      return total / 1_000;
    });
    const ratios = levels.map(level => rankFor(STRIKE, level).mult);
    expect(ratios).toEqual([1, 1.6, 2.4]);
    means.forEach((mean, i) => expect(Math.abs(mean / means[0] / ratios[i] - 1)).toBeLessThanOrEqual(0.05));
  });

  it('RanksScaleMagnitudesWithStarterWeapon', () => {
    // Same scaling claim as RanksScaleMagnitudes, but with the actual starter
    // weapon (worn_shortsword, 3-6 dmg) instead of a zeroed weapon, so this
    // captures the ratio M6-4 tuning must actually balance against: the flat
    // rank bonus (bonusDamage=6) is diluted by the weapon's own damage roll.
    // Expected mean = weaponRollMean(4.5) + bonusDamage(6) * rankMult, so the
    // ratio to level 1 is (4.5 + 6*mult) / (4.5 + 6*1):
    //   L1:  1
    //   L8:  (4.5 + 6*1.6) / 10.5  = 14.1 / 10.5  ≈ 1.342857 (~1.34)
    //   L16: (4.5 + 6*2.4) / 10.5  = 18.9 / 10.5  = 1.8
    const levels = [1, 8, 16];
    const means = levels.map(level => {
      const state = caster('warrior', level);
      const rng = mulberry32(81);
      let total = 0;
      for (let roll = 0; roll < 1_000; roll++) {
        total += damage(resolveCast(rng, STRIKE, state, { ...target, level }, NOW).effects);
      }
      return total / 1_000;
    });
    const weaponMean = (weapon.dmgMin + weapon.dmgMax) / 2;
    const bonusDamage = 6;
    const ratios = levels.map(level => {
      const { mult } = rankFor(STRIKE, level);
      return (weaponMean + bonusDamage * mult) / (weaponMean + bonusDamage * rankFor(STRIKE, levels[0]).mult);
    });
    expect(ratios[0]).toBeCloseTo(1, 6);
    expect(ratios[1]).toBeCloseTo(1.342857142857143, 6);
    expect(ratios[2]).toBeCloseTo(1.8, 6);
    means.forEach((mean, i) => expect(Math.abs(mean / means[0] / ratios[i] - 1)).toBeLessThanOrEqual(0.05));
  });

  it('SlowMagnitudeIsAClampedPercent', () => {
    // slow.magnitude is a PERCENT (0-90), not a fraction; content uses e.g. pct: 50.
    const def = { ...STRIKE, effects: [{ kind: 'slow', pct: 50, durationSec: 8 } as AbilityEffect] };
    const unranked = resolveCast(() => 0.5, def, caster(), target, NOW).effects[0];
    expect(unranked).toMatchObject({ kind: 'aura', effectKind: 'slow', magnitude: 50 });
    // A 2.4x rank multiplier would push 50 * 2.4 = 120, but it must clamp to 90.
    const ranked = { ...def, ranks: [{ level: 1, magnitudeMult: 2.4 }] };
    const rankedEffect = resolveCast(() => 0.5, ranked, caster(), target, NOW).effects[0];
    expect(rankedEffect).toMatchObject({ kind: 'aura', effectKind: 'slow', magnitude: 90 });
  });

  it('DotAndHotRejectZeroTicksAndRoundTickCount', () => {
    for (const kind of ['dot', 'hot'] as const) {
      const zeroTick = { ...STRIKE,
        effects: [{ kind, totalDamage: 30, totalHeal: 30, durationSec: 6, tickSec: 0 } as unknown as AbilityEffect] };
      expect(() => resolveCast(() => 0.5, zeroTick, caster(), target, NOW)).toThrow(/tickSec and durationSec/);
      const zeroDuration = { ...STRIKE,
        effects: [{ kind, totalDamage: 30, totalHeal: 30, durationSec: 0, tickSec: 2 } as unknown as AbilityEffect] };
      expect(() => resolveCast(() => 0.5, zeroDuration, caster(), target, NOW)).toThrow(/tickSec and durationSec/);
    }
    // durationSec/tickSec = 6/4 = 1.5, rounds to 2 ticks (not truncated to 1).
    const nonIntegral = { ...STRIKE,
      effects: [{ kind: 'dot', totalDamage: 30, durationSec: 6, tickSec: 4 } as AbilityEffect] };
    const effect = resolveCast(() => 0.5, nonIntegral, caster(), target, NOW).effects[0];
    expect(effect).toMatchObject({ kind: 'aura', effectKind: 'dot', magnitude: 15 });
  });

  it('ValidateCastRejectsEachGuard', () => {
    type Args = Parameters<typeof validateCast>;
    const cases: Record<CastRejection, Args> = {
      unknownAbility: [undefined, caster(), target, 1, NOW],
      wrongClass: [STRIKE, caster('oracle'), target, 1, NOW],
      levelTooLow: [{ ...STRIKE, minLevel: 2 }, caster(), target, 1, NOW],
      outOfRange: [STRIKE, caster(), target, STRIKE.rangeM + 0.01, NOW],
      onCooldown: [STRIKE, { ...caster(), cooldownsMicros: { [STRIKE.id]: NOW + 1n } }, target, 1, NOW],
      onGcd: [STRIKE, { ...caster(), lastGcdAtMicros: NOW + 1n }, target, 1, NOW],
      noResource: [STRIKE, { ...caster(), resource: STRIKE.cost - 1 }, target, 1, NOW],
      noTarget: [STRIKE, caster(), null, 1, NOW],
      targetDead: [STRIKE, caster(), { ...target, hp: 0 }, 1, NOW],
      casterDead: [STRIKE, { ...caster(), hp: 0 }, target, 1, NOW],
    };
    expect(Object.keys(cases)).toEqual(ALL_REJECTIONS);
    for (const reason of ALL_REJECTIONS) expect(validateCast(...cases[reason])).toBe(reason);
    const ready = { ...caster(), resource: STRIKE.cost, lastGcdAtMicros: NOW,
      cooldownsMicros: { [STRIKE.id]: NOW } };
    expect(validateCast(STRIKE, ready, target, STRIKE.rangeM, NOW)).toBeNull();
    for (const dist of [NaN, Infinity, -1]) expect(validateCast(STRIKE, ready, target, dist, NOW)).toBe('outOfRange');
    const self = ABILITIES.warrior_battle_shout;
    expect(validateCast(self, caster('warrior', self.minLevel), null, Infinity, NOW)).toBeNull();
    expect(validateCast(self, caster('warrior', self.minLevel), { ...target, hp: 0 }, 99, NOW)).toBeNull();
  });

  it('ResolveIsDeterministicForASeed', () => {
    const inputs = ALL_ABILITIES.map(def => ({ def, state: caster(def.classId, 16), target: { ...target } }));
    const before = structuredClone(inputs);
    const run = () => {
      const rng = mulberry32(12345);
      return JSON.stringify(inputs.map(({ def, state, target: t }) => resolveCast(rng, def, state, t, NOW)),
        (_key, value) => typeof value === 'bigint' ? value.toString() : value);
    };
    expect(run()).toBe(run());
    expect(inputs).toEqual(before);
  });

  it('GcdMatchesResourceKind', () => {
    for (const kit of Object.values(CLASS_KITS)) {
      const def = ABILITIES[kit.abilityIds[0]];
      const state = caster(kit.classId);
      const gcdSec = kit.resource === 'energy' ? GCD_SEC_ENERGY : GCD_SEC;
      expect(resolveCast(() => 0.5, def, state, target, NOW).gcdUntilMicros)
        .toBe(NOW + BigInt(gcdSec * 1_000_000));
      const offGcd = { ...def, triggersGcd: false };
      for (const expiry of [0n, NOW + 500_000n]) {
        const active = { ...state, lastGcdAtMicros: expiry };
        expect(validateCast(offGcd, active, target, 1, NOW)).toBeNull();
        expect(resolveCast(() => 0.5, offGcd, active, target, NOW).gcdUntilMicros).toBe(expiry);
      }
    }
  });

  it('selects the highest eligible rank without mutating content and honors zero cost', () => {
    const def = { ...STRIKE, ranks: [
      { level: 16, magnitudeMult: 2.4 }, { level: 8, magnitudeMult: 1.6, cost: 0 },
    ] };
    expect(rankFor(def, 7)).toEqual({ mult: 1, cost: 15 });
    expect(rankFor(def, 8)).toEqual({ mult: 1.6, cost: 0 });
    expect(rankFor(def, 15)).toEqual({ mult: 1.6, cost: 0 });
    expect(rankFor(def, 16)).toEqual({ mult: 2.4, cost: 15 });
    expect(def.ranks.map(r => r.level)).toEqual([16, 8]);
    const state = { ...caster('warrior', 8), resource: 0 };
    expect(validateCast(def, state, target, 1, NOW)).toBeNull();
    expect(resolveCast(() => 0.5, def, state, target, NOW).resourceSpent).toBe(0);
    const costly = { ...def, ranks: [{ level: 8, magnitudeMult: 1.6, cost: 30 }] };
    expect(validateCast(costly, { ...state, resource: 29 }, target, 1, NOW)).toBe('noResource');
  });

  it('uses derived attributes and the physical hit formula including target armor and level', () => {
    const state = { ...caster(), attrs: { STR: 28, DEX: 50 } };
    const defender = { ...target, level: 4, armor: 400 };
    const stats = deriveStats(state.attrs, state.level, CLASS_KITS.warrior);
    for (let seed = 0; seed < 100; seed++) {
      const expected = resolvePhysicalHit(mulberry32(seed), {
        attackerLevel: state.level, defenderLevel: defender.level,
        weaponDmgMin: weapon.dmgMin, weaponDmgMax: weapon.dmgMax, weaponSpeedSec: weapon.speedSec,
        attackPower: stats.attackPower, critChance: stats.critChance, defenderArmor: defender.armor,
        bonusDamage: 6,
      });
      expect(resolveCast(mulberry32(seed), STRIKE, state, defender, NOW).effects)
        .toEqual([{ kind: 'damage', amount: expected.damage, hit: expected.result }]);
    }
  });

  it('handles spell hit outcomes, physical-only armor, healing crits and instant cast times', () => {
    for (const kind of ['directDamage', 'aoeDamage'] as const) {
      const def: AbilityDef = { ...STRIKE, castTimeSec: 3,
        effects: [{ kind, min: 20, max: 20, radiusM: 5 }], school: 'fire' };
      for (const [roll, hit, amount] of [[0, 'miss', 0], [0.07, 'dodge', 0], [0.12, 'crit', 30], [0.5, 'hit', 20]] as const) {
        const result = resolveCast(() => roll, def, caster(), { ...target, armor: 485 }, NOW);
        expect(result.effects).toEqual([{ kind: 'damage', amount, hit }]);
        expect(result.gcdUntilMicros).toBe(NOW + BigInt(GCD_SEC * 1_000_000));
        expect(result.resourceSpent).toBe(def.cost);
      }
      expect(damage(resolveCast(() => 0.5, { ...def, school: 'physical' }, caster(),
        { ...target, armor: 485 }, NOW).effects)).toBe(10);
    }
    const heal: AbilityDef = { ...STRIKE, effects: [{ kind: 'heal', min: 10, max: 20 }] };
    const rolls = [0.5, 0]; // Damage roll then crit; zero must never become a miss.
    expect(resolveCast(() => rolls.shift()!, heal, caster(), target, NOW).effects)
      .toEqual([{ kind: 'heal', amount: Math.round(15 * CRIT_MULT) }]);
    const ward = ABILITIES.oracle_frost_ward;
    expect(resolveCast(() => 0, ward, caster('oracle', 4), null, NOW).effects[0])
      .toMatchObject({ kind: 'aura', onSelf: true, magnitude: 25, tickSec: 0 });
    expect(() => resolveCast(() => 0.5, STRIKE, caster(), null, NOW)).toThrow('without a target');
  });
});

describe('R6 time-to-kill report (informational, no balance assertion)', () => {
  it('prints naked level-1 warrior versus forest_wolf over 200 seeded runs', () => {
    const wolf = MOBS.find(m => m.mobType === 'forest_wolf')!;
    const state = caster(); // Empty AttributeBlock per D82; starter weapon contributes damage only.
    const def = ABILITIES[CLASS_KITS.warrior.abilityIds[0]];
    let totalCasts = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rng = mulberry32(seed);
      const victim = { level: wolf.level, hp: wolf.maxHp, maxHp: wolf.maxHp, armor: 0 };
      let now = 0n;
      while (victim.hp > 0) {
        const result = resolveCast(rng, def, state, victim, now);
        victim.hp -= damage(result.effects);
        totalCasts++;
        now = result.gcdUntilMicros;
      }
    }
    // Sustained casts at one per GCD; no resource starvation, regen model, or wolf retaliation.
    // Show both elapsed time (first instant cast at t=0) and full GCD budget to avoid ambiguity.
    const meanCasts = totalCasts / 200;
    console.log([
      'R6: naked warrior L1 (attrs={}), 200 seeded runs, sustained casts',
      '| Weapon | Target | HP | Ability | Mean casts | GCD s | Mean elapsed s | Mean GCD budget s |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      `| ${ITEMS.worn_shortsword.id} | ${wolf.mobType} | ${wolf.maxHp} | ${def.id}`
        + ` | ${meanCasts} | ${GCD_SEC} | ${((meanCasts - 1) * GCD_SEC).toFixed(4)}`
        + ` | ${(meanCasts * GCD_SEC).toFixed(4)} |`,
    ].join('\n'));
  });
});
