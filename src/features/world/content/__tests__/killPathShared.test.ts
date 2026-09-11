/**
 * KillPathIsSharedWithCastAbility (M6 architecture §2.9, D89).
 *
 * `castAbility` (melee fallback) and `castAbilityById` (the M6 ability
 * reducer) both kill mobs. The kill is not one write: it schedules a respawn,
 * deletes the row, credits quest kill counts, and rolls loot. Duplicating that
 * across two reducers fails silently — the mob still dies, but the quest
 * counter or the loot roll quietly stops matching the other path.
 *
 * So the whole block lives in `spacetimedb/src/combat/kill.ts` and this suite
 * is what keeps it there. It is a source-level assertion because the module
 * cannot be imported outside a SpacetimeDB host: `index.ts` calls
 * `schema({...})` at load, which needs the WASM runtime's syscalls.
 *
 * The two administrative `mob.mobId.delete` callsites in `index.ts` (seedWorld
 * retiring a row whose spawn definition is gone, and dungeon-instance
 * teardown) are NOT kills — nothing is credited and no respawn is queued — so
 * they carry a `NON-KILL MOB DELETE` marker comment and are allowed by name.
 * A new unmarked delete fails this suite, which is the point: it forces the
 * author to say which kind of delete they are adding.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '../../../../..');
const indexSrc = readFileSync(
  join(repoRoot, 'spacetimedb/src/index.ts'), 'utf8',
);
const killSrc = readFileSync(
  join(repoRoot, 'spacetimedb/src/combat/kill.ts'), 'utf8',
);

const stateSrc = readFileSync(
  join(repoRoot, 'spacetimedb/src/combat/state.ts'), 'utf8',
);

/**
 * Every .ts file under `spacetimedb/src`, minus the shared kill helper itself and the
 * generated content mirror.
 *
 * This used to be a hand-written list of six paths, which meant a NEW module
 * file was invisible to the guard below — the "one kill path" invariant would
 * silently stop being enforced for exactly the files most likely to break it.
 * Globbing costs nothing and has no maintenance surface (review M-2).
 */
function moduleFiles(): string[] {
  const root = join(repoRoot, 'spacetimedb/src');
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        const rel = relative(repoRoot, full).split(sep).join(posix.sep);
        // kill.ts IS the kill path; content/** is the mirror of
        // src/features/world/content and is never hand-edited.
        if (rel === 'spacetimedb/src/combat/kill.ts') continue;
        if (rel.startsWith('spacetimedb/src/content/')) continue;
        out.push(rel);
      }
    }
  };
  walk(root);
  return out;
}

const MODULE_FILES = moduleFiles();

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Source lines with `needle`, paired with the three lines above them. */
function linesWith(src: string, needle: string): { line: string; prev: string }[] {
  const lines = src.split('\n');
  const out: { line: string; prev: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(needle)) continue;
    // A marker comment may wrap, so look back over the whole comment block.
    out.push({ line: lines[i], prev: lines.slice(Math.max(0, i - 3), i).join('\n') });
  }
  return out;
}

describe('KillPathIsSharedWithCastAbility', () => {
  it('globs every module file rather than a hand-written list', () => {
    // Guards the guard: if the walk ever silently returns nothing, every
    // assertion below would pass vacuously.
    expect(MODULE_FILES).toContain('spacetimedb/src/index.ts');
    expect(MODULE_FILES).toContain('spacetimedb/src/combat/auras.ts');
    expect(MODULE_FILES).not.toContain('spacetimedb/src/combat/kill.ts');
    expect(MODULE_FILES.length).toBeGreaterThan(6);
  });

  it('schedules mob respawns in exactly one place', () => {
    expect(occurrences(killSrc, 'mobRespawnQueue.insert')).toBe(1);
    for (const file of MODULE_FILES) {
      const src = readFileSync(join(repoRoot, file), 'utf8');
      expect(
        occurrences(src, 'mobRespawnQueue.insert'),
        `${file} must not schedule a respawn — call applyMobKill instead`,
      ).toBe(0);
    }
  });

  it('deletes a mob as a kill only from combat/kill.ts', () => {
    expect(occurrences(killSrc, 'ctx.db.mob.mobId.delete(')).toBe(1);
    // Every other delete in the module — in ANY file, not just index.ts — must
    // declare itself a non-kill (review N-3: this assertion used to scan
    // index.ts alone, so an unmarked kill-delete in a future combat/*.ts would
    // have passed while the respawn assertion beside it globbed correctly).
    let seen = 0;
    for (const file of MODULE_FILES) {
      const src = readFileSync(join(repoRoot, file), 'utf8');
      for (const { line, prev } of linesWith(src, 'ctx.db.mob.mobId.delete')) {
        seen++;
        expect(
          prev.includes('NON-KILL MOB DELETE'),
          `unmarked mob delete in ${file}: ${line.trim()}`,
        ).toBe(true);
      }
    }
    expect(seen, 'the marker convention must actually be exercised').toBeGreaterThan(0);
  });

  it('routes both cast reducers through applyMobKill', () => {
    const castAbility = indexSrc.slice(
      indexSrc.indexOf('export const castAbility = spacetimedb.reducer'),
      indexSrc.indexOf('export const castAbilityById = spacetimedb.reducer'),
    );
    const castAbilityById = indexSrc.slice(
      indexSrc.indexOf('export const castAbilityById = spacetimedb.reducer'),
      indexSrc.indexOf('export const tickAuras = spacetimedb.reducer'),
    );
    expect(castAbility.length).toBeGreaterThan(0);
    expect(castAbilityById.length).toBeGreaterThan(0);
    expect(occurrences(castAbility, 'applyMobKill(')).toBe(1);
    expect(occurrences(castAbilityById, 'applyMobKill(')).toBe(1);
  });

  it('keeps quest credit and loot inside the shared helper', () => {
    // If either of these ever moves back into a reducer, the two paths can
    // diverge again — which is the exact failure D89 exists to prevent.
    expect(killSrc).toContain('creditKillToQuests(');
    expect(killSrc).toContain('grantMobLoot(');
    expect(killSrc).toContain('refreshCollectQuestProgress(');
    expect(occurrences(indexSrc, 'grantMobLoot(')).toBe(0);
  });
});

/**
 * M6-4 review H-1 / H-2, pinned at source for the same reason as the suite
 * above: `index.ts` cannot be imported outside a SpacetimeDB host, so the
 * shape of these two guarantees is asserted against the text.
 */
describe('CastThrottleAndLazyRegen', () => {
  const castById = indexSrc.slice(
    indexSrc.indexOf('export const castAbilityById = spacetimedb.reducer'),
    indexSrc.indexOf('export const tickAuras = spacetimedb.reducer'),
  );
  const tickAuras = indexSrc.slice(
    indexSrc.indexOf('export const tickAuras = spacetimedb.reducer'),
    indexSrc.indexOf('export const reapCombatEvents = spacetimedb.reducer'),
  );

  it('throttles castAbilityById before doing any work', () => {
    expect(castById.length).toBeGreaterThan(0);
    const throttle = castById.indexOf('nowMicros - player.lastAttackAt < CAST_THROTTLE_MICROS');
    expect(throttle, 'castAbilityById must carry a pre-work throttle').toBeGreaterThan(-1);
    // Nothing may run before it: no resolver call, no table scan, and above
    // all no combatEvent insert.
    for (const needle of ['resolveCast(', 'equippedSnapshot(', 'emitCombatEvent(']) {
      const at = castById.indexOf(needle);
      expect(at === -1 || at > throttle, `${needle} runs before the throttle`).toBe(true);
    }
  });

  it('caps rejection events at one per caster per throttle window', () => {
    // The only combatEvent writer on a rejection path is reject(), and reject()
    // must push the caster's floor forward, so the next call inside the window
    // is dropped by the throttle above before it can insert a second row.
    const reject = castById.slice(
      castById.indexOf('const reject = (reason: string)'),
      castById.indexOf('// Dead players cannot cast'),
    );
    expect(reject).toContain("kind: 'rejected'");
    expect(reject).toContain('lastAttackAt: nowMicros');
    expect(occurrences(reject, 'emitCombatEvent(')).toBe(1);
    expect(indexSrc).toContain('const CAST_THROTTLE_MICROS = 300_000n;');
    // The floor must NOT ride on the public GCD column: stamping it would
    // render an ordinary mis-click as a real global cooldown (review N-1).
    expect(reject).not.toContain('lastGcdAt:');
  });

  it('leaves the GCD to validateCast so off-GCD abilities still cast', () => {
    // `titan_immovable` (triggersGcd: false) exists to be pressed WHILE the
    // GCD runs. A pre-lookup GCD gate in the reducer would swallow it.
    const beforeLookup = castById.slice(0, castById.indexOf('const def = abilityById(abilityId)'));
    expect(beforeLookup).not.toContain('player.lastGcdAt');
    expect(beforeLookup).not.toContain('nowMicros < player.lastGcdAt');
  });

  it('regenerates resource lazily on cast, not on a 1 Hz sweep (D94)', () => {
    expect(castById).toContain('regeneratedResource(');
    expect(castById).toContain('player.lastRegenAt');
    expect(castById).toContain('lastRegenAt: nowMicros');
    // The sweep is gone: tickAuras must not touch resource at all.
    expect(tickAuras).not.toContain('RESOURCE_REGEN_FRACTION_PER_SEC');
    expect(tickAuras).not.toContain('resourceMaxFor(');
    expect(tickAuras).not.toContain('resource:');
  });

  it('keeps the regen constant and formula in combat/state.ts (D94)', () => {
    expect(stateSrc).toContain('export const RESOURCE_REGEN_FRACTION_PER_SEC = 0.05;');
    expect(stateSrc).toContain('export function regeneratedResource(');
    expect(occurrences(indexSrc, 'RESOURCE_REGEN_FRACTION_PER_SEC')).toBe(0);
  });

  it('takes exactly one playerEquipped snapshot per cast', () => {
    expect(occurrences(castById, 'equippedSnapshot(')).toBe(1);
    expect(occurrences(castById, 'resourceMaxFor(')).toBe(0);
    expect(occurrences(castById, 'equippedAttributes(')).toBe(0);
  });

  it('skips loot and quest credit on a dot kill', () => {
    expect(tickAuras).toContain('false, // creditKill: no player landed this blow');
    expect(tickAuras).toContain('const removedAuraIds = new Set<bigint>();');
    expect(tickAuras).toContain('if (removedAuraIds.has(row.id)) continue;');
  });

  it('keeps lastRegenAt as the last player column', () => {
    const table = indexSrc.slice(
      indexSrc.indexOf('resource:     t.f32().default(0)'),
      indexSrc.indexOf('chatMessage: table('),
    );
    const cols = [...table.matchAll(/^\s{6}(\w+):\s+t\./gm)].map((m) => m[1]);
    expect(cols[cols.length - 1]).toBe('lastRegenAt');
  });
});
