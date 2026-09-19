/**
 * R21 — server-side interior nav for a SECOND dungeon.
 *
 * Until this landed, every interior-resolution path on the server closed over
 * Castle Ashwood's grids: `castle/surface.ts` read CASTLE_NAV_META /
 * CASTLE_LEVELS / CASTLE_STAIRS at module scope, so the Barrowdeep's own
 * committed bitmaps (M11-5, `spacetimedb/src/barrowdeep/navGrids.ts`) had no
 * reader at all and `dungeonUsesCastleInteriorNav('barrowdeep')` was
 * deliberately false. Three live consequences, all of which this file tests as
 * CONSEQUENCES rather than as plumbing:
 *
 *   1. No wall collision inside the Barrowdeep — `movePlayer` fell through to
 *      the outdoor px clamp, which zone 2's raised 500 m box (D175) fully
 *      contains, so no step inside the barrow was ever rejected.
 *   2. Combat broken, not just collision — `index.ts`'s
 *      `else if (existing.floorYM !== 0) { nextFloorYM = 0 }` forced the
 *      player's floor to 0 on their first step inside, while
 *      `seedDungeonInstanceMobs` correctly placed that instance's mobs at
 *      11.0 / 0.6. `sameInteriorFloor` tolerates 0.55 m, so every attack was
 *      rejected and every mob excluded the player as a target.
 *   3. Mob AI frozen — `tickMobAI`'s interior stepper converted zone 2 px
 *      WITHOUT the Barrowdeep's origin offset and queried Ashwood's grid, found
 *      no surface, and handed each mob back its previous position forever.
 *
 * The bar for the fix is that Castle Ashwood's own behaviour is unchanged.
 * The first describe below is that bar, as a golden sweep whose expected
 * values were measured on `origin/main` (593ed40) BEFORE any edit.
 *
 * WHY THIS FILE IS HERE and not beside interiorNav.ts: `spacetime publish`
 * type-checks the whole `spacetimedb/src` tree, test files included, and
 * `spacetimedb/package.json` declares no vitest (D179 — a fix is held for
 * Brandon in PR #371, and that file is reserved). Adding another
 * vitest-importing file under `spacetimedb/src` would deepen that, so this
 * sits in the root tree and reaches across, the way `zoneBounds.test.js` and
 * `dungeonInteriorCoupling.test.ts` already do.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  interiorFloorYAtPx,
  interiorMobStepPx,
  interiorSurfaceAt,
  isInInterior,
  pxToWorldM,
  resolveInteriorStep,
  scanInteriorSurface,
  worldMToPx,
  type DungeonInteriorNav,
} from '../../../../spacetimedb/src/dungeon/interiorNav.ts';
import {
  CASTLE_INTERIOR_NAV,
  castleInteriorMoveAllowed,
  castleInteriorRecoverSurface,
  castleInteriorResolveMove,
  castleInteriorSurfaceAt,
  sameInteriorFloor,
} from '../../../../spacetimedb/src/castle/surface.ts';
import {
  DUNGEON_INTERIOR_ENTRY,
  dungeonInteriorNavFor,
  dungeonSpawnFloorYM,
  dungeonSpawnPx,
  getDungeonForInstance,
  interiorLocalToPx,
  interiorNavForDungeon,
  interiorNavForInstance,
  type DungeonInstanceLookup,
} from '../../../../spacetimedb/src/dungeon/helpers.ts';
import { DUNGEONS, ZONES_BY_ID } from '../../../../spacetimedb/src/content/index.js';
import { resolveZone } from '../../../../spacetimedb/src/world/zones.ts';
import {
  CASTLE_NAV_META,
  CASTLE_LEVELS,
  CASTLE_STEP_UP,
} from '../../../../spacetimedb/src/castle/navGrids.ts';
import { BARROWDEEP_LEVELS } from '../../../../spacetimedb/src/barrowdeep/navGrids.ts';

const repoRoot = join(import.meta.dirname, '../../../..');
const ashwoodNav = dungeonInteriorNavFor('castle_ashwood')!;
const barrowdeepNav = dungeonInteriorNavFor('barrowdeep')!;

/** A finite window wide enough to catch a surface on ANY level of either dungeon. */
const ALL_LEVELS_WINDOW = { min: -1000, max: 1000 };

function hasAnySurface(nav: DungeonInteriorNav, wx: number, wz: number): boolean {
  if (!isInInterior(nav, wx, wz)) return false;
  return scanInteriorSurface(
    nav, wx, wz, ALL_LEVELS_WINDOW.min, ALL_LEVELS_WINDOW.max, nav.readCell,
  ) != null;
}

/** Zone-local metres → the px pair the server actually stores, for `nav`'s zone. */
function localToPx(nav: DungeonInteriorNav, xm: number, zm: number): { x: number; y: number } {
  return { x: worldMToPx(xm, nav.originOffsetM.x), y: worldMToPx(zm, nav.originOffsetM.z) };
}

// ---------------------------------------------------------------------------

describe('THE BAR: Castle Ashwood resolves byte-identically through the descriptor table', () => {
  /**
   * A deterministic sweep of the four public resolution entry points over
   * 6,000 pseudo-random points spanning the whole interior footprint plus an
   * 8 m rind of out-of-bounds padding, folded into two independent FNV-1a
   * hashes plus the serialized length.
   *
   * The expected values were measured against `origin/main` (593ed40) with
   * this exact sweep before a single line was edited, so they are an oracle,
   * not a transcription of the new code's own answers. Any change to the
   * scan, the stair interpolation, the wall-slide order, the recovery window
   * or the px/m conversions moves them.
   */
  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function fnv1a(str: string, basis = 0x811c9dc5): string {
    let h = basis >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function sweep(): string {
    const { anchor, bounds } = CASTLE_NAV_META;
    const rnd = lcg(20260919);
    const parts: string[] = [];
    const padX = 8, padZ = 8;
    for (let i = 0; i < 6000; i++) {
      const lx = bounds.x0 - padX + rnd() * (bounds.x1 - bounds.x0 + 2 * padX);
      const lz = bounds.z0 - padZ + rnd() * (bounds.z1 - bounds.z0 + 2 * padZ);
      const wx = anchor.x + lx;
      const wz = anchor.z + lz;
      const levelY = CASTLE_LEVELS[Math.floor(rnd() * CASTLE_LEVELS.length)].y;
      const cy = levelY + (rnd() - 0.5) * 3;
      const s = castleInteriorSurfaceAt(wx, wz, cy);
      parts.push(s ? `${s.y}|${s.level}` : 'n');
      const r = castleInteriorRecoverSurface(wx, wz, cy);
      parts.push(r ? `${r.y}|${r.level}` : 'n');
      const a = castleInteriorMoveAllowed(wx, wz, cy);
      parts.push(a === null ? 'x' : a ? '1' : '0');
      const dx = (rnd() - 0.5) * 3;
      const dz = (rnd() - 0.5) * 3;
      const mv = castleInteriorResolveMove(wx, wz, wx + dx, wz + dz, cy);
      parts.push(`${mv.x},${mv.z},${mv.floorYM},${mv.surface ? `${mv.surface.y}|${mv.surface.level}` : 'n'}`);
      parts.push(`${pxToWorldM(worldMToPx(wx))},${sameInteriorFloor(cy, levelY) ? 1 : 0}`);
    }
    return parts.join(';');
  }

  it('the 30,000-value sweep hashes exactly as it did before the refactor', () => {
    const joined = sweep();
    const reversed = [...joined].reverse().join('');
    expect(joined.length, 'sweep shape changed').toBe(493375);
    expect(fnv1a(joined), 'Castle Ashwood interior resolution drifted').toBe('1d249d46');
    expect(fnv1a(reversed, 0x1000193), 'Castle Ashwood interior resolution drifted').toBe('846add8c');
  });

  it('and the named landmarks inside it still read the same floors', () => {
    // Human-readable companions to the hash, measured the same way: a hash
    // mismatch says "something moved", these say roughly what.
    expect(castleInteriorSurfaceAt(840 - 46.375, 0, 11)).toEqual({ y: 11, level: 1 });
    expect(castleInteriorSurfaceAt(840 - 53.375, 0, 11)).toEqual({ y: 11, level: 1 });
    expect(castleInteriorSurfaceAt(840, 0, 11)).toEqual({ y: 11, level: 1 });
    expect(castleInteriorSurfaceAt(840, 0, 0.6)).toEqual({ y: 0.6, level: 0 });
  });

  it('Castle Ashwood still resolves at a ZERO origin offset (zone 1), as the retired code assumed', () => {
    expect(ashwoodNav.originOffsetM).toEqual({ x: 0, z: 0 });
    expect(ZONES_BY_ID[1].originOffsetM).toEqual({ x: 0, z: 0 });
    // The retired module's literal formulas, which every castle call site used.
    expect(pxToWorldM(1920, ashwoodNav.originOffsetM.x)).toBe((1920 - 1600) / 32);
    expect(worldMToPx(10, ashwoodNav.originOffsetM.x)).toBe(10 * 32 + 1600);
  });
});

// ---------------------------------------------------------------------------

describe('each dungeon\'s descriptor is derived from its own emitted data, not declared next to it', () => {
  it.each(DUNGEONS.map((d) => [d.id] as [string]))(
    '%s: entryLevelIndex names the storey its spawn point actually stands on',
    (id) => {
      // `entryLevelIndex` is the one hand-written number in the descriptor
      // (deriving it means decoding the whole grid at module load). This is
      // its derivation: scan the COMMITTED bitmaps at the dungeon's own
      // spawnLocal and require the surface there to be the declared storey.
      const nav = dungeonInteriorNavFor(id)!;
      const entry = DUNGEON_INTERIOR_ENTRY[id];
      const wx = entry.anchor.x + entry.spawnLocal.x;
      const wz = entry.anchor.z + entry.spawnLocal.z;
      const surface = interiorSurfaceAt(nav, wx, wz, nav.entryFloorYM);
      expect(surface, `${id}'s spawn point is not on a walkable cell`).not.toBeNull();
      expect(surface!.y).toBe(nav.entryFloorYM);
      expect(surface!.level).toBe(nav.entryLevelIndex);
      expect(nav.entryFloorYM).toBe(nav.levels[nav.entryLevelIndex].y);
    },
  );

  it('Ashwood\'s entry floor is CASTLE_LEVELS[1], the Barrowdeep\'s is BARROWDEEP_LEVELS[1]', () => {
    // D171 gave the Barrowdeep Ashwood's level Y verbatim, which is exactly
    // why `enterDungeon`'s hardcoded `CASTLE_LEVELS[1].y` looked correct: the
    // two tables agree TODAY. Pinning both sides separately is what makes the
    // coincidence stop being load-bearing.
    expect(ashwoodNav.entryFloorYM).toBe(CASTLE_LEVELS[1].y);
    expect(barrowdeepNav.entryFloorYM).toBe(BARROWDEEP_LEVELS[1].y);
    expect(ashwoodNav.entryFloorYM).toBe(11);
    expect(barrowdeepNav.entryFloorYM).toBe(11);
  });

  it('every dungeon declares the same step-up, because sameInteriorFloor is still one shared tolerance', () => {
    // sameInteriorFloor's callers (melee range, ability targeting, mob target
    // selection) hold rows, not descriptors, so it keeps ONE tolerance. That
    // is only safe while every dungeon agrees on it — this is the guard that
    // makes a dungeon which ever disagrees fail loudly.
    for (const d of DUNGEONS) {
      const nav = dungeonInteriorNavFor(d.id)!;
      expect(nav.stepUp, `${d.id} disagrees with sameInteriorFloor's tolerance`).toBe(CASTLE_STEP_UP);
    }
    expect(sameInteriorFloor(11, 11 + CASTLE_STEP_UP * 0.99)).toBe(true);
    expect(sameInteriorFloor(11, 11 + CASTLE_STEP_UP * 1.01)).toBe(false);
    // The storey gap both dungeons ship (11 - 0.6) is ~19x the tolerance,
    // which is why a wrong floor is total rather than marginal.
    expect(sameInteriorFloor(11, 0.6)).toBe(false);
  });

  it('the Barrowdeep resolves against zone 2\'s origin offset, three kilometres east', () => {
    expect(barrowdeepNav.originOffsetM).toEqual({ x: 3000, z: 0 });
    expect(barrowdeepNav.originOffsetM).toEqual(ZONES_BY_ID[2].originOffsetM);
    // The offset is what makes the px the server stores addressable at all.
    // With zone 1's (i.e. the retired hardcoded zero), the barrow's own spawn
    // px converts to a metre coordinate 3 km outside its own footprint.
    const spawnPx = dungeonSpawnPx(DUNGEONS.find((d) => d.id === 'barrowdeep')!);
    const correctX = pxToWorldM(spawnPx.x, barrowdeepNav.originOffsetM.x);
    const wrongX = pxToWorldM(spawnPx.x, 0);
    expect(isInInterior(barrowdeepNav, correctX, pxToWorldM(spawnPx.y, 0))).toBe(true);
    expect(isInInterior(barrowdeepNav, wrongX, pxToWorldM(spawnPx.y, 0))).toBe(false);
    expect(wrongX - correctX).toBe(3000);
  });
});

// ---------------------------------------------------------------------------

describe('CONSEQUENCE 1 — a player\'s first move inside the Barrowdeep keeps its floor', () => {
  const barrowdeep = DUNGEONS.find((d) => d.id === 'barrowdeep')!;
  const spawnPx = dungeonSpawnPx(barrowdeep);

  /** One step east of the spawn, in px, staying on the entry passage. */
  const stepPx = { x: spawnPx.x + 8, y: spawnPx.y };

  it('enterDungeon seeds the entered dungeon\'s own entry floor, not CASTLE_LEVELS[1]', () => {
    const server = readFileSync(join(repoRoot, 'spacetimedb/src/index.ts'), 'utf8');
    const body = server.slice(
      server.indexOf('export const enterDungeon'),
      server.indexOf('export const leaveDungeon'),
    );
    expect(body).toContain('dungeonInteriorNavFor(dungeonId)?.entryFloorYM');
    expect(body).toContain('floorYM: entryFloorYM');
    expect(body, 'enterDungeon still hardcodes Ashwood\'s level table')
      .not.toMatch(/floorYM:\s*CASTLE_LEVELS/);
  });

  it('the interior branch is now TAKEN for the Barrowdeep — the floor-zeroing else no longer fires', () => {
    // This is the precise statement of the fix. `movePlayer`'s else-branch is
    // unchanged and still right for a player who is not inside a registered
    // interior; what changed is that the Barrowdeep no longer falls into it.
    const server = readFileSync(join(repoRoot, 'spacetimedb/src/index.ts'), 'utf8');
    const mover = server.slice(server.indexOf('export const movePlayer'));
    expect(mover).toMatch(/if \(interiorNav\) \{[\s\S]{0,900}\} else if \(existing\.floorYM !== 0\) \{\s*\n\s*nextFloorYM = 0;/);
    expect(dungeonInteriorNavFor('barrowdeep')).not.toBeNull();
  });

  it('the first step after entering keeps floorYM at the gallery floor (11), not 0', () => {
    // storedFloorYM is what enterDungeon just wrote; claimedFloorYM is the
    // client's matching claim; guardClamped false = an ordinary paced step.
    const step = resolveInteriorStep(
      barrowdeepNav,
      spawnPx.x, spawnPx.y, barrowdeepNav.entryFloorYM,
      stepPx.x, stepPx.y, barrowdeepNav.entryFloorYM,
      false,
    );
    expect(step, 'an ordinary step off the Barrowdeep spawn must not be rejected').not.toBeNull();
    expect(step!.floorYM).toBe(11);
    expect(step!.floorYM).not.toBe(0);
  });

  it('and it still resolves from a stored floor of 0 (a row written before enterDungeon was fixed)', () => {
    // refY falls back to the dungeon's OWN entry floor, so a row that came in
    // with floorYM 0 recovers onto 11 rather than being stranded.
    const step = resolveInteriorStep(
      barrowdeepNav, spawnPx.x, spawnPx.y, 0, stepPx.x, stepPx.y, 0, false,
    );
    expect(step).not.toBeNull();
    expect(step!.floorYM).toBe(11);
  });

  it('THE COMBAT CONSEQUENCE: player and mob now agree on the floor, so attacks resolve', () => {
    // seedDungeonInstanceMobs writes mob.floorYM from dungeonSpawnFloorYM, and
    // the Barrowdeep really does place mobs on both storeys. Every gate that
    // matters — meleeAttack, castAbilityById's target resolution, tickMobAI's
    // isValidMobTarget — is `sameInteriorFloor(mob.floorYM, player.floorYM)`,
    // which tolerates 0.55 m against a 10.4 m storey gap.
    const galleryMob = barrowdeep.spawns
      .map((s) => dungeonSpawnFloorYM(s.netId))
      .find((y) => y === 11);
    const deepMob = barrowdeep.spawns
      .map((s) => dungeonSpawnFloorYM(s.netId))
      .find((y) => y === 0.6);
    expect(galleryMob, 'no Barrowdeep mob on the gallery level').toBe(11);
    expect(deepMob, 'no Barrowdeep mob on the deep level').toBe(0.6);

    const playerFloor = resolveInteriorStep(
      barrowdeepNav,
      spawnPx.x, spawnPx.y, barrowdeepNav.entryFloorYM,
      stepPx.x, stepPx.y, barrowdeepNav.entryFloorYM,
      false,
    )!.floorYM;

    expect(sameInteriorFloor(playerFloor, galleryMob!)).toBe(true);
    // The bug, quantified: with floorYM zeroed, every mob on either storey was
    // out of reach and excluded the player as a target.
    expect(sameInteriorFloor(0, galleryMob!)).toBe(false);
    expect(sameInteriorFloor(0, deepMob!)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('CONSEQUENCE 2 — a Barrowdeep mob can actually move', () => {
  /**
   * A walkable pair on the Barrowdeep's gallery level: the entry spawn, and a
   * point a few metres further in. Found by scanning the committed bitmaps
   * rather than hard-coded, so a re-emit of the plan cannot silently make this
   * test measure a wall.
   */
  const gallery = (() => {
    const entry = DUNGEON_INTERIOR_ENTRY.barrowdeep;
    const x0 = entry.anchor.x + entry.spawnLocal.x;
    const z0 = entry.anchor.z + entry.spawnLocal.z;
    for (let d = 1; d <= 30; d += 0.25) {
      if (interiorSurfaceAt(barrowdeepNav, x0 + d, z0, 11)) return { x0, z0, x1: x0 + d, z1: z0 };
    }
    return null;
  })();

  it('found a walkable gallery pair to step between', () => {
    expect(gallery, 'no walkable cell east of the Barrowdeep spawn — nav data missing?').toBeTruthy();
    expect(interiorSurfaceAt(barrowdeepNav, gallery!.x0, gallery!.z0, 11)!.y).toBe(11);
  });

  it('steps toward the target instead of being handed back its previous position', () => {
    const from = localToPx(barrowdeepNav, gallery!.x0, gallery!.z0);
    const toward = localToPx(barrowdeepNav, gallery!.x1, gallery!.z1);
    const moved = interiorMobStepPx(barrowdeepNav, from.x, from.y, toward.x, toward.y, 11);
    expect(moved.landed, 'the mob found no surface at its own step target').toBe(true);
    expect(moved.x).toBeCloseTo(toward.x, 6);
    expect(moved.y).toBeCloseTo(toward.y, 6);
    expect(moved.x).not.toBe(from.x);
    expect(moved.floorYM).toBe(11);
  });

  it('THE BUG: the same step against Castle Ashwood\'s grid freezes the mob exactly where it stood', () => {
    // This is what `tickMobAI` did for every Barrowdeep mob before R21 —
    // zone 2 px through a zero origin offset into Ashwood's grid, no surface
    // found, previous position returned. Kept as an assertion so reverting the
    // routing cannot pass silently.
    const from = localToPx(barrowdeepNav, gallery!.x0, gallery!.z0);
    const toward = localToPx(barrowdeepNav, gallery!.x1, gallery!.z1);
    const frozen = interiorMobStepPx(CASTLE_INTERIOR_NAV, from.x, from.y, toward.x, toward.y, 11);
    expect(frozen.landed).toBe(false);
    expect(frozen.x).toBe(from.x);
    expect(frozen.y).toBe(from.y);
  });

  it('a mob whose floorYM was never set backfills from its OWN dungeon\'s levels', () => {
    // tickMobAI's `if (inDungeon && nextFloorYM === 0)` backfill. It scanned
    // CASTLE_LEVELS through Ashwood's grid, so a Barrowdeep mob kept 0 and
    // then failed every sameInteriorFloor check for the rest of its life.
    const from = localToPx(barrowdeepNav, gallery!.x0, gallery!.z0);
    expect(interiorFloorYAtPx(barrowdeepNav, from.x, from.y, 0)).toBe(11);
    expect(interiorFloorYAtPx(CASTLE_INTERIOR_NAV, from.x, from.y, 0)).toBe(0);
  });

  it('but it still cannot walk through a wall', () => {
    const wall = findWall();
    const from = localToPx(barrowdeepNav, wall.fromX, wall.fromZ);
    const into = localToPx(barrowdeepNav, wall.wallX, wall.wallZ);
    const blocked = interiorMobStepPx(barrowdeepNav, from.x, from.y, into.x, into.y, 11);
    // Wall-slide: one axis may survive, but the blocked axis never does.
    expect(blocked.x === into.x && blocked.y === into.y).toBe(false);
  });
});

// ---------------------------------------------------------------------------

/**
 * A blocked column inside the Barrowdeep's own footprint, adjacent to a
 * walkable gallery cell. "Blocked" means no surface on ANY level, so the
 * rejection cannot be an artifact of the step-up/step-down window.
 */
/** A walkable / fully-blocked pair inside Castle Ashwood, found the same way. */
function ashwoodWallPair(): { walkable: { x: number; z: number }; blocked: { x: number; z: number } } {
  const { anchor, bounds } = CASTLE_NAV_META;
  let blocked: { x: number; z: number } | null = null;
  let walkable: { x: number; z: number } | null = null;
  for (let xm = bounds.x0; xm < bounds.x1 && !walkable; xm += 0.5) {
    for (let zm = bounds.z0; zm < bounds.z1; zm += 0.5) {
      const p = { x: anchor.x + xm, z: anchor.z + zm };
      if (!walkable && castleInteriorSurfaceAt(p.x, p.z, 11)) walkable = p;
      if (!blocked && !hasAnySurface(ashwoodNav, p.x, p.z)) blocked = p;
      if (walkable && blocked) break;
    }
  }
  if (!walkable || !blocked) throw new Error('no walkable/blocked pair in Castle Ashwood — nav data missing?');
  return { walkable, blocked };
}

function findWall(): { fromX: number; fromZ: number; wallX: number; wallZ: number } {
  const entry = DUNGEON_INTERIOR_ENTRY.barrowdeep;
  const x0 = entry.anchor.x + entry.spawnLocal.x;
  const z0 = entry.anchor.z + entry.spawnLocal.z;
  const cell = barrowdeepNav.meta.navCellM;
  for (let d = 0; d <= 40; d += cell) {
    for (const [dx, dz] of [[d, 0], [0, d], [0, -d], [-d, 0]] as const) {
      const wx = x0 + dx, wz = z0 + dz;
      if (!isInInterior(barrowdeepNav, wx, wz)) continue;
      if (hasAnySurface(barrowdeepNav, wx, wz)) continue;
      // Walk back toward the spawn until we find the walkable neighbour.
      for (let back = cell; back <= d; back += cell) {
        const fx = x0 + (dx === 0 ? 0 : dx > 0 ? d - back : -(d - back));
        const fz = z0 + (dz === 0 ? 0 : dz > 0 ? d - back : -(d - back));
        if (interiorSurfaceAt(barrowdeepNav, fx, fz, 11)) {
          return { fromX: fx, fromZ: fz, wallX: wx, wallZ: wz };
        }
      }
    }
  }
  throw new Error('no blocked cell found next to the Barrowdeep spawn — nav data missing?');
}

describe('CONSEQUENCE 3 — a Barrowdeep wall is now enforced server-side', () => {
  const wall = findWall();
  const fromPx = localToPx(barrowdeepNav, wall.fromX, wall.fromZ);
  const wallPx = localToPx(barrowdeepNav, wall.wallX, wall.wallZ);

  it('found a blocked column next to a walkable one, both inside the footprint', () => {
    expect(interiorSurfaceAt(barrowdeepNav, wall.fromX, wall.fromZ, 11)).not.toBeNull();
    expect(isInInterior(barrowdeepNav, wall.wallX, wall.wallZ)).toBe(true);
    expect(hasAnySurface(barrowdeepNav, wall.wallX, wall.wallZ)).toBe(false);
  });

  it('an unclamped claim into the wall is REJECTED', () => {
    expect(
      resolveInteriorStep(barrowdeepNav, fromPx.x, fromPx.y, 11, wallPx.x, wallPx.y, 11, false),
    ).toBeNull();
  });

  it('a speed-clamped claim into the wall is SLID, never stored as-is', () => {
    // The clamped arm never rejects from a walkable stored position (that
    // would wedge the row); it wall-slides instead. Either way the player does
    // not end up standing in the wall.
    const slid = resolveInteriorStep(
      barrowdeepNav, fromPx.x, fromPx.y, 11, wallPx.x, wallPx.y, 11, true,
    );
    expect(slid).not.toBeNull();
    expect(slid!.x === wallPx.x && slid!.y === wallPx.y).toBe(false);
    expect(slid!.floorYM).toBe(11);
  });

  it('THE BUG: the outdoor clamp this used to fall through to accepts the wall position happily', () => {
    // Zone 2's box was raised to 500 m to host this interior (D175), so the
    // whole footprint is in bounds — `resolveZone` returns the claim
    // untouched, which is why walking through every wall in the barrow
    // produced no symptom at all server-side.
    const outdoor = resolveZone(wallPx.x, wallPx.y);
    expect(outdoor.inBounds).toBe(true);
    expect(outdoor.zoneId).toBe(2);
    expect(outdoor.x).toBe(wallPx.x);
    expect(outdoor.y).toBe(wallPx.y);
  });

  it('and Castle Ashwood\'s walls are still enforced the same way they were', () => {
    // The same assertion shape against Ashwood, so a change that loosened
    // collision for both dungeons could not hide behind the Barrowdeep being
    // newly covered.
    const { walkable, blocked } = ashwoodWallPair();
    expect(
      resolveInteriorStep(
        ashwoodNav,
        worldMToPx(walkable.x), worldMToPx(walkable.z), 11,
        worldMToPx(blocked.x), worldMToPx(blocked.z), 11,
        false,
      ),
    ).toBeNull();
  });
});

describe('strict when unclamped, wall-slide when clamped — asserted, not just pinned in source', () => {
  /**
   * `moveGuard.test.js` pins this structurally (the strict all-or-nothing
   * check must not live in the clamped arm). That pin is a regex over source
   * text and cannot see behaviour, so the contract itself is asserted here for
   * BOTH dungeons now that resolveInteriorStep is a pure function.
   *
   * Why the two arms differ: clamping projects the step along the straight
   * chord to the claim, which indoors can cross a wall even when both
   * endpoints are walkable — rejecting there would let the speed guard
   * synthesise a nav-blocked point out of a legal move and strand the row. An
   * unclamped claim has no such excuse: the client already wall-slides
   * locally, so a blocked point is spoofed or desynced and is refused.
   */
  const cases = (() => {
    const ca = ashwoodWallPair();
    const bd = findWall();
    return [
      {
        id: 'castle_ashwood',
        nav: ashwoodNav,
        from: { x: worldMToPx(ca.walkable.x), y: worldMToPx(ca.walkable.z) },
        wall: { x: worldMToPx(ca.blocked.x), y: worldMToPx(ca.blocked.z) },
      },
      {
        id: 'barrowdeep',
        nav: barrowdeepNav,
        from: localToPx(barrowdeepNav, bd.fromX, bd.fromZ),
        wall: localToPx(barrowdeepNav, bd.wallX, bd.wallZ),
      },
    ];
  })();

  it.each(cases.map((c) => [c.id, c] as [string, typeof cases[number]]))(
    '%s: an unclamped wall claim is REFUSED and a clamped one is SLID, never stored raw',
    (_id, c) => {
      expect(
        resolveInteriorStep(c.nav, c.from.x, c.from.y, 11, c.wall.x, c.wall.y, 11, false),
        'unclamped claims must not be quietly slid',
      ).toBeNull();

      const slid = resolveInteriorStep(
        c.nav, c.from.x, c.from.y, 11, c.wall.x, c.wall.y, 11, true,
      );
      expect(slid, 'a clamped step from a walkable spot must never strand the row').not.toBeNull();
      expect(slid!.x === c.wall.x && slid!.y === c.wall.y, 'the raw wall claim was stored').toBe(false);
      expect(slid!.floorYM).toBe(11);
    },
  );
});

// ---------------------------------------------------------------------------

describe('CONSEQUENCE 4 — the REDUCERS themselves read the table, for a non-Ashwood dungeon', () => {
  /**
   * Why this block exists, in its own words: everything above proves the
   * descriptor table and the resolution engine are right. None of it proves
   * that `movePlayer` and `tickMobAI` actually *ask the table which dungeon
   * the player/mob is in* — narrowing either reducer's lookup back to Castle
   * Ashwood reinstates the original shipped bug verbatim, and the engine-level
   * tests keep passing because the engine is still correct; it is just being
   * handed the wrong descriptor.
   *
   * `spacetimedb/src/index.ts` cannot be imported under vitest to close that
   * directly: it imports `spacetimedb/server`, which does not parse under
   * plain node (`SyntaxError: Unexpected identifier 'iter'`) and is pinned to
   * 2.2.0 in the module's own install against 2.10.0 in the root one, so even
   * a stubbed import would exercise the wrong runtime. So the gate is closed
   * from both sides instead:
   *
   *   1. the lookup each reducer performs is a real function in
   *      dungeon/helpers.ts, exercised here against a fake instance table for
   *      BOTH dungeons — a behavioural test of the routing itself; and
   *   2. the reducer bodies are pinned to call exactly those functions with
   *      the row's own instance id, and index.ts is pinned to contain no
   *      Ashwood hardcode at all — neither the descriptor nor the id literal.
   */
  const server = readFileSync(join(repoRoot, 'spacetimedb/src/index.ts'), 'utf8');

  /** A fake `dungeonInstance` table: instance id -> the dungeon it hosts. */
  function instanceTable(rows: Record<string, string>): DungeonInstanceLookup {
    return {
      db: {
        dungeonInstance: {
          instanceId: {
            find: (id: bigint) => (rows[String(id)] ? { dungeonId: rows[String(id)] } : null),
          },
        },
      },
    };
  }

  const ctx = instanceTable({
    '1': 'castle_ashwood',
    '7': 'barrowdeep',
    '9': 'a_dungeon_the_content_package_no_longer_ships',
  });

  it('movePlayer\'s gate returns the BARROWDEEP\'s grids for a Barrowdeep instance', () => {
    // The whole bug in one assertion: instance 7 is a Barrowdeep instance, so
    // the player standing in it must be resolved against the Barrowdeep.
    const nav = interiorNavForInstance(ctx, 7n);
    expect(nav).toBe(barrowdeepNav);
    expect(nav).not.toBe(ashwoodNav);
    expect(nav!.dungeonId).toBe('barrowdeep');
    expect(nav!.zoneId).toBe(2);
  });

  it('and Castle Ashwood\'s for an Ashwood instance — the gate discriminates, it does not just always answer', () => {
    const nav = interiorNavForInstance(ctx, 1n);
    expect(nav).toBe(ashwoodNav);
    expect(nav).not.toBe(barrowdeepNav);
  });

  it('null for outdoors, a stale instance id, and a dungeon the content package dropped', () => {
    expect(interiorNavForInstance(ctx, 0n), 'an outdoor player').toBeNull();
    expect(interiorNavForInstance(ctx, 404n), 'an instance row that is gone').toBeNull();
    expect(interiorNavForInstance(ctx, 9n), 'an unshipped dungeon id').toBeNull();
    // Null means "skip interior rules", never "fall back to Ashwood's walls".
    expect(interiorNavForInstance(ctx, 9n)).not.toBe(ashwoodNav);
  });

  it('tickMobAI\'s gate answers off the already-resolved DungeonDef, and agrees with movePlayer\'s', () => {
    // Different signature (it reuses the DungeonDef the boss-mechanics lookup
    // already needed, to avoid a second dungeonInstance read), so it gets its
    // own coverage rather than being assumed equivalent.
    for (const [instanceId, expected] of [[1n, ashwoodNav], [7n, barrowdeepNav]] as const) {
      const dungeon = getDungeonForInstance(ctx, instanceId);
      expect(interiorNavForDungeon(dungeon)).toBe(expected);
      expect(interiorNavForDungeon(dungeon)).toBe(interiorNavForInstance(ctx, instanceId));
    }
    expect(interiorNavForDungeon(null)).toBeNull();
    expect(interiorNavForDungeon(getDungeonForInstance(ctx, 9n))).toBeNull();
  });

  it('THE REGRESSION, end to end: a Barrowdeep instance rejects a Barrowdeep wall; Ashwood\'s grids would not', () => {
    // Chains the reducer's own gate into the resolution the reducer performs,
    // so this fails if EITHER half regresses.
    const wall = findWall();
    const fromPx = localToPx(barrowdeepNav, wall.fromX, wall.fromZ);
    const wallPx = localToPx(barrowdeepNav, wall.wallX, wall.wallZ);

    const viaGate = interiorNavForInstance(ctx, 7n)!;
    expect(
      resolveInteriorStep(viaGate, fromPx.x, fromPx.y, 11, wallPx.x, wallPx.y, 11, false),
      'a wall claim inside a Barrowdeep instance must be rejected',
    ).toBeNull();

    // What a reducer hardcoded to Ashwood does with the identical claim: the
    // position is ~3 km outside Ashwood's footprint, so it is never even a
    // candidate for rejection — which is the bug, not a near miss.
    expect(isInInterior(ashwoodNav, pxToWorldM(wallPx.x, 0), pxToWorldM(wallPx.y, 0))).toBe(false);
    expect(
      interiorMobStepPx(ashwoodNav, fromPx.x, fromPx.y, wallPx.x, wallPx.y, 11).landed,
    ).toBe(false);
  });

  /** A reducer's body: from its `export const <name>` to the next top-level export. */
  function reducerBody(name: string): string {
    const start = server.indexOf(`export const ${name} = spacetimedb.reducer`);
    expect(start, `reducer ${name} not found in index.ts`).toBeGreaterThan(-1);
    const next = server.indexOf('\nexport const ', start + 1);
    return server.slice(start, next === -1 ? undefined : next);
  }

  it('movePlayer asks the table which dungeon THIS PLAYER is in', () => {
    const body = reducerBody('movePlayer');
    expect(body).toContain('interiorNavForInstance(ctx, existing.dungeonInstanceId)');
    expect(body).toContain('if (interiorNav) {');
  });

  it('tickMobAI asks the table which dungeon THIS MOB is in', () => {
    const body = reducerBody('tickMobAI');
    expect(body).toContain('getDungeonForInstance(ctx, mob.dungeonInstanceId)');
    expect(body).toContain('interiorNavForDungeon(mobDungeon)');
    expect(body).toContain('if (!mobNav) {');
  });

  it('and NOTHING in index.ts can name one dungeon\'s interior directly', () => {
    // The net under both pins above. A reducer can only be narrowed back to
    // Castle Ashwood by naming Ashwood — either its descriptor or its content
    // id — so forbidding both in this file makes that mutation unwritable
    // rather than merely unlikely.
    expect(server, 'index.ts imports a specific dungeon\'s nav descriptor')
      .not.toContain('CASTLE_INTERIOR_NAV');
    expect(server, 'index.ts hardcodes a dungeon id literal')
      .not.toMatch(/['"`]castle_ashwood['"`]/);
    expect(server, 'index.ts hardcodes a dungeon id literal')
      .not.toMatch(/['"`]barrowdeep['"`]/);
    // ...and the per-id lookup that remains (enterDungeon's) is fed the
    // reducer's own argument, never a literal.
    expect(server).not.toMatch(/dungeonInteriorNavFor\(\s*['"`]/);
    expect(server).toContain('dungeonInteriorNavFor(dungeonId)');
  });
});

describe('the two interiors never resolve against each other', () => {
  it('a point inside the Barrowdeep is outside Castle Ashwood, and vice versa', () => {
    const bd = DUNGEON_INTERIOR_ENTRY.barrowdeep;
    const bdWorld = { x: bd.anchor.x + bd.spawnLocal.x, z: bd.anchor.z + bd.spawnLocal.z };
    expect(isInInterior(barrowdeepNav, bdWorld.x, bdWorld.z)).toBe(true);
    expect(isInInterior(ashwoodNav, bdWorld.x, bdWorld.z)).toBe(false);

    const ca = DUNGEON_INTERIOR_ENTRY.castle_ashwood;
    const caWorld = { x: ca.anchor.x + ca.spawnLocal.x, z: ca.anchor.z + ca.spawnLocal.z };
    expect(isInInterior(ashwoodNav, caWorld.x, caWorld.z)).toBe(true);
    expect(isInInterior(barrowdeepNav, caWorld.x, caWorld.z)).toBe(false);
  });

  it('their stored px are ~3 km apart, in different zones', () => {
    const bdPx = dungeonSpawnPx(DUNGEONS.find((d) => d.id === 'barrowdeep')!);
    const caPx = dungeonSpawnPx(DUNGEONS.find((d) => d.id === 'castle_ashwood')!);
    expect(resolveZone(bdPx.x, bdPx.y).zoneId).toBe(2);
    expect(resolveZone(caPx.x, caPx.y).zoneId).toBe(1);
    expect(Math.abs(bdPx.x - caPx.x) / 32).toBeGreaterThan(2500);
  });

  it('interiorLocalToPx and the nav scan agree on where interior (0,0) is, for both', () => {
    // The placement path (which spawns the mobs) and the collision path (which
    // decides whether they can move) must fold the same anchor and the same
    // zone offset, or mobs are seeded where the grid says there is nothing.
    for (const dungeon of DUNGEONS) {
      const nav = dungeonInteriorNavFor(dungeon.id)!;
      const px = interiorLocalToPx(dungeon, { x: 0, z: 0 });
      expect(pxToWorldM(px.x, nav.originOffsetM.x)).toBeCloseTo(nav.meta.anchor.x, 9);
      expect(pxToWorldM(px.y, nav.originOffsetM.z)).toBeCloseTo(nav.meta.anchor.z, 9);
    }
  });
});
