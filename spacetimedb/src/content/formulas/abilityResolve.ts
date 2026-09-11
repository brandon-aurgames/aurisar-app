// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/formulas/abilityResolve.ts
// Regenerate with: node scripts/sync_world_content.mjs

/** Pure M6 ability resolution. Validate first; the caller applies the returned deltas. */
import type { AbilityDef, AbilityEffect, AttributeBlock, ClassId } from '../types';
import { CLASS_KITS } from '../classes';
import {
  armorDR, CRIT_MULT, deriveStats, GCD_SEC, GCD_SEC_ENERGY,
  hitRoll, resolvePhysicalHit, rollDamage,
} from './combat';
import type { HitResult, Rng } from './combat';

export interface CasterState {
  level: number;
  classId: ClassId;
  attrs: AttributeBlock;
  resource: number;
  hp: number;
  maxHp: number;
  weapon: { dmgMin: number; dmgMax: number; speedSec: number };
  cooldownsMicros: Record<string, bigint>;
  /** GCD expiry (despite the legacy "last" name), not the previous cast time. */
  lastGcdAtMicros: bigint;
}

export interface TargetState {
  level: number;
  hp: number;
  maxHp: number;
  armor: number;
}

export type CastRejection =
  | 'unknownAbility' | 'wrongClass' | 'levelTooLow' | 'outOfRange'
  | 'onCooldown' | 'onGcd' | 'noResource' | 'noTarget' | 'targetDead' | 'casterDead';

export type ResolvedEffect =
  | { kind: 'damage'; amount: number; hit: HitResult }
  | { kind: 'heal'; amount: number }
  /**
   * `magnitude` is per-tick amount for dot/hot/absorb/selfBuff/buffTarget, but
   * for `slow` it is a PERCENT (0-90, content uses e.g. `pct: 50`) and is
   * clamped so a 2.4x rank multiplier cannot push it past 100%.
   */
  | { kind: 'aura'; effectKind: AbilityEffect['kind']; onSelf: boolean;
      stat?: string; magnitude: number; durationSec: number; tickSec: number };

export function rankFor(def: AbilityDef, level: number): { mult: number; cost: number } {
  let selected: NonNullable<AbilityDef['ranks']>[number] | undefined;
  for (const rank of def.ranks ?? []) {
    if (rank.level <= level && (!selected || rank.level > selected.level)) selected = rank;
  }
  return { mult: selected?.magnitudeMult ?? 1, cost: selected?.cost ?? def.cost };
}

export function validateCast(
  def: AbilityDef | null | undefined,
  caster: CasterState,
  target: TargetState | null | undefined,
  distM: number,
  nowMicros: bigint,
): CastRejection | null {
  if (caster.hp <= 0) return 'casterDead';
  if (!def) return 'unknownAbility';
  if (def.classId !== caster.classId) return 'wrongClass';
  if (caster.level < def.minLevel) return 'levelTooLow';
  if (def.triggersGcd && nowMicros < caster.lastGcdAtMicros) return 'onGcd';
  if (nowMicros < (caster.cooldownsMicros[def.id] ?? 0n)) return 'onCooldown';
  if (caster.resource < rankFor(def, caster.level).cost) return 'noResource';
  // Content uses rangeM = 0 for self casts; they ignore any selected target.
  if (def.rangeM > 0) {
    if (!target) return 'noTarget';
    if (target.hp <= 0) return 'targetDead';
    if (!Number.isFinite(distM) || distM < 0 || distM > def.rangeM) return 'outOfRange';
  }
  return null;
}

/**
 * Resolves an accepted cast immediately, including nonzero castTimeSec (D85).
 * No mutation, resource regeneration, HP clamping, AoE enumeration, or aura ticking:
 * these deltas describe one recipient and the reducer owns applying them.
 */
export function resolveCast(
  rng: Rng,
  def: AbilityDef,
  caster: CasterState,
  target: TargetState | null | undefined,
  nowMicros: bigint,
): {
  effects: ResolvedEffect[];
  resourceSpent: number;
  cooldownUntilMicros: bigint;
  gcdUntilMicros: bigint;
} {
  const { mult, cost } = rankFor(def, caster.level);
  const kit = CLASS_KITS[caster.classId];
  const stats = deriveStats(caster.attrs, caster.level, kit);
  const onSelf = def.rangeM === 0;
  const recipient = onSelf ? { ...caster, armor: stats.baseArmor } : target;
  if (!recipient) throw new Error('Cannot resolve a targeted ability without a target');

  const effects = def.effects.map((effect): ResolvedEffect => {
    switch (effect.kind) {
      case 'weaponStrike': {
        const hit = resolvePhysicalHit(rng, {
          attackerLevel: caster.level, defenderLevel: recipient.level,
          weaponDmgMin: caster.weapon.dmgMin, weaponDmgMax: caster.weapon.dmgMax,
          weaponSpeedSec: caster.weapon.speedSec,
          attackPower: stats.attackPower, critChance: stats.critChance,
          defenderArmor: recipient.armor, bonusDamage: effect.bonusDamage * mult,
        });
        return { kind: 'damage', amount: hit.damage, hit: hit.result };
      }
      case 'directDamage':
      case 'aoeDamage': {
        const hit = hitRoll(rng, caster.level, recipient.level, stats.critChance);
        if (hit === 'miss' || hit === 'dodge') return { kind: 'damage', amount: 0, hit };
        let amount = rollDamage(rng, effect.min * mult, effect.max * mult);
        if (hit === 'crit') amount *= CRIT_MULT;
        if (def.school === 'physical') amount *= 1 - armorDR(recipient.armor, caster.level);
        return { kind: 'damage', amount: Math.max(1, Math.round(amount)), hit };
      }
      case 'heal': {
        let amount = rollDamage(rng, effect.min * mult, effect.max * mult);
        if (rng() < stats.critChance) amount *= CRIT_MULT;
        return { kind: 'heal', amount: Math.round(amount) };
      }
      case 'dot':
      case 'hot': {
        if (effect.tickSec <= 0 || effect.durationSec <= 0) {
          throw new Error(
            `Invalid ${effect.kind} content on ${def.id}: tickSec and durationSec must be > 0`,
          );
        }
        // Round to a whole tick count so a non-integral duration/tickSec ratio
        // does not silently under-deliver total damage/healing.
        const ticks = Math.max(1, Math.round(effect.durationSec / effect.tickSec));
        return {
          kind: 'aura', effectKind: effect.kind, onSelf,
          magnitude: (effect.kind === 'dot' ? effect.totalDamage : effect.totalHeal) * mult / ticks,
          durationSec: effect.durationSec, tickSec: effect.tickSec,
        };
      }
      case 'absorb':
        return { kind: 'aura', effectKind: effect.kind, onSelf,
          magnitude: effect.amount * mult, durationSec: effect.durationSec, tickSec: 0 };
      case 'selfBuff':
      case 'buffTarget':
        return { kind: 'aura', effectKind: effect.kind,
          onSelf: effect.kind === 'selfBuff' || onSelf, stat: effect.stat,
          magnitude: effect.amount * mult, durationSec: effect.durationSec, tickSec: 0 };
      case 'stun':
      case 'root':
        // Control effects have no numeric magnitude in content; duration is unscaled.
        return { kind: 'aura', effectKind: effect.kind, onSelf,
          magnitude: 0, durationSec: effect.durationSec, tickSec: 0 };
      case 'slow':
        // magnitude is a PERCENT (0-90), clamped so rank scaling cannot exceed 100%.
        return { kind: 'aura', effectKind: effect.kind, onSelf,
          magnitude: Math.min(90, effect.pct * mult), durationSec: effect.durationSec, tickSec: 0 };
      default: {
        const unhandled: never = effect;
        throw new Error(`Unknown ability effect kind: ${(unhandled as AbilityEffect).kind}`);
      }
    }
  });

  // These are also the canonical constants exported to formulas.json.
  const gcdSec = kit.resource === 'energy' ? GCD_SEC_ENERGY : GCD_SEC;
  return {
    effects,
    resourceSpent: cost,
    cooldownUntilMicros: nowMicros + BigInt(Math.round(def.cooldownSec * 1_000_000)),
    // An off-GCD cast must not clear an already active GCD.
    gcdUntilMicros: def.triggersGcd
      ? nowMicros + BigInt(Math.round(gcdSec * 1_000_000)) : caster.lastGcdAtMicros,
  };
}
