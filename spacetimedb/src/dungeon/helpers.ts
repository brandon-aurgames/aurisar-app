/**
 * Dungeon instance helpers — server-side px/coord + spawn indexing.
 * Mirrors src/features/world/castle/castleDungeon.js.
 */

import { MOBS } from '../content/index.js';
import { DUNGEONS } from '../content/dungeons/index.js';
import { CASTLE_ASHWOOD_ENTRY, CASTLE_ASHWOOD_SPAWNS } from '../content/dungeons/castleAshwood.generated.js';
import { BARROWDEEP_ENTRY, BARROWDEEP_INTERIOR_ANCHOR, BARROWDEEP_SPAWNS } from '../content/dungeons/barrowdeep.generated.js';
import {
  BARROWDEEP_LEVELS,
  BARROWDEEP_NAV_BITMAPS_B64,
  BARROWDEEP_NAV_META,
  BARROWDEEP_ROOM_FLOOR_Y,
  BARROWDEEP_STAIRS,
  BARROWDEEP_STEP_DOWN,
  BARROWDEEP_STEP_UP,
} from '../barrowdeep/navGrids.js';
import { CASTLE_LEVELS, CASTLE_ROOM_FLOOR_Y } from '../castle/navGrids.js';
import { CASTLE_INTERIOR_NAV } from '../castle/surface.js';
import { makeInteriorNav, type DungeonInteriorNav } from './interiorNav.js';
import type { DungeonDef, DungeonSpawnDef, MobDef } from '../content/types.js';
import { contentPosToPx, WORLD_ORIGIN_PX } from '../world/zones.js';

export const WORLD_CENTER_PX = WORLD_ORIGIN_PX;
export const PX_PER_M = 32;
export const CASTLE_INTERIOR_ANCHOR = { x: 840, z: 0 } as const;
export const DUNGEON_MAX_PLAYERS = 5;
export const DUNGEON_GATE_RANGE_PX = 6 * PX_PER_M;
export const DUNGEON_EXIT_RANGE_PX = 4 * PX_PER_M;

export const DUNGEONS_BY_ID: Record<string, DungeonDef> = Object.fromEntries(
  DUNGEONS.map((d) => [d.id, d]),
);

export interface DungeonSpawnEntry {
  spawn: DungeonSpawnDef;
  mobDef: MobDef;
  instanceIndex: number;
}

export const dungeonSpawnByNetId = new Map<string, DungeonSpawnEntry>();
for (const dungeon of DUNGEONS) {
  for (const spawn of dungeon.spawns) {
    const mobDef = MOBS[spawn.mobType];
    if (!mobDef) continue;
    for (let i = 0; i < spawn.count; i++) {
      dungeonSpawnByNetId.set(`${spawn.netId}_${i}`, { spawn, mobDef, instanceIndex: i });
    }
  }
}

/**
 * Per-dungeon interior placement data that has nowhere else to live:
 * DungeonDef (content/types.ts) carries no interior-frame field, because
 * only this server module's interior-resolution code needs one. Keyed by
 * DungeonDef.id — a lookup table, not a string-literal check — so a second
 * dungeon starts resolving correctly the moment it registers a row here,
 * instead of every call site that touches interiors growing its own
 * `dungeonId === 'castle_ashwood'` branch (D174).
 *
 * `anchor` is the zone-local meters point, in the dungeon's OWN zone (per
 * its DungeonDef.entrance.zoneId), that the dungeon's interior-local (0,0)
 * sits at — e.g. Ashwood's is 840 m east of zone 1's origin, far enough from
 * the playable disc that an outdoor proximity check can never wander into it
 * by accident (D65). `spawnLocal`/`exitHotspotLocal` are interior-local
 * meters, the same frame as DungeonSpawnDef.pos.
 */
interface DungeonInteriorEntry {
  anchor: { x: number; z: number };
  spawnLocal: { x: number; z: number };
  exitHotspotLocal: { x: number; z: number };
  /**
   * THIS dungeon's own interior nav grids — the descriptor every interior
   * resolution path (movePlayer's wall collision and floor tracking, mob AI
   * stepping, mob floor backfill) is routed through.
   *
   * This used to be `castleNavBitmaps: boolean`, i.e. "does this dungeon
   * resolve against castle/navGrids.ts specifically", and the Barrowdeep had
   * to answer `false`: its own bitmaps were emitted and committed but
   * castle/surface.ts's scan closed over CASTLE_NAV_META / CASTLE_LEVELS /
   * CASTLE_STAIRS, so claiming them would have checked every step inside the
   * barrow against Ashwood's walls ~3 km away in another zone. Answering
   * `false` meant no collision at all, plus a player floorYM forced to 0 while
   * the instance's own mobs sat at 11.0 / 0.6 (D174 item 3; R21).
   *
   * A real grid reference answers both questions at once and cannot be wrong
   * in that direction: a dungeon's row can only ever name its own grids.
   */
  nav: DungeonInteriorNav;
}

/**
 * The Barrowdeep's interior nav descriptor (M11-5's emitted grids, wired up by
 * R21). Zone-local to zone 2 — `BARROWDEEP_NAV_META.zoneId` is the emitter's
 * own field, so the zone this resolves against comes from the generated data
 * rather than from a literal here.
 */
const BARROWDEEP_INTERIOR_NAV: DungeonInteriorNav = makeInteriorNav({
  dungeonId: 'barrowdeep',
  zoneId: BARROWDEEP_NAV_META.zoneId,
  meta: BARROWDEEP_NAV_META,
  bitmapsB64: BARROWDEEP_NAV_BITMAPS_B64,
  levels: BARROWDEEP_LEVELS,
  stairs: BARROWDEEP_STAIRS,
  stepUp: BARROWDEEP_STEP_UP,
  stepDown: BARROWDEEP_STEP_DOWN,
  // BARROWDEEP_LEVELS[1] is "gallery" (y = 11), the storey the entry passage
  // and its spawn point sit on — the same relationship CASTLE_LEVELS[1]
  // ("ground") has to Ashwood's. Pinned against a real scan of the committed
  // bitmaps at BARROWDEEP_ENTRY.spawnLocal by dungeonInteriorNav.test.ts.
  entryLevelIndex: 1,
});

export const DUNGEON_INTERIOR_ENTRY: Record<string, DungeonInteriorEntry> = {
  castle_ashwood: {
    anchor: CASTLE_INTERIOR_ANCHOR,
    spawnLocal: CASTLE_ASHWOOD_ENTRY.spawnLocal,
    exitHotspotLocal: CASTLE_ASHWOOD_ENTRY.exitHotspotLocal,
    nav: CASTLE_INTERIOR_NAV,
  },
  barrowdeep: {
    // Zone-local to zone 2 (D175). Imported from the generated plan rather
    // than re-typed the way CASTLE_INTERIOR_ANCHOR is, so the emitter is the
    // only thing that can move it.
    anchor: BARROWDEEP_INTERIOR_ANCHOR,
    spawnLocal: BARROWDEEP_ENTRY.spawnLocal,
    exitHotspotLocal: BARROWDEEP_ENTRY.exitHotspotLocal,
    nav: BARROWDEEP_INTERIOR_NAV,
  },
};

/**
 * `dungeonId`'s OWN interior nav grids, or null when it has no interior row.
 *
 * Replaces `dungeonUsesCastleInteriorNav`, which could only ever answer "is
 * this Castle Ashwood". Callers get the grids to resolve against instead of a
 * yes/no about one particular dungeon's grids, so a dungeon that registers its
 * own interior starts resolving correctly rather than not at all (D174 item 3,
 * R21). Null still means "skip interior rules entirely" — never "check it
 * against the wrong dungeon's walls".
 */
export function dungeonInteriorNavFor(dungeonId: string): DungeonInteriorNav | null {
  return DUNGEON_INTERIOR_ENTRY[dungeonId]?.nav ?? null;
}

/**
 * The minimum a reducer ctx must expose to answer "which dungeon is this
 * instance". Structural, not the real ReducerContext, so the two functions
 * below are callable from a unit test with a fake row table — `index.ts`
 * itself cannot be imported under vitest (it imports `spacetimedb/server`,
 * which does not parse under plain node and is pinned to a different version
 * in the module's own install than in the root one), so the reducer-level gate
 * has to be reachable without it.
 */
export interface DungeonInstanceLookup {
  db: { dungeonInstance: { instanceId: { find: (id: bigint) => { dungeonId: string } | null } } };
}

/**
 * The DungeonDef an instance belongs to, or null outside any instance.
 *
 * Lives here rather than in bossMechanics.ts (where it used to) because it
 * reads DUNGEONS_BY_ID from this module and is now the shared first half of
 * both reducer-level gates — boss mechanics AND interior nav.
 */
export function getDungeonForInstance(
  ctx: DungeonInstanceLookup,
  instanceId: bigint,
): DungeonDef | null {
  if (instanceId === 0n) return null;
  const inst = ctx.db.dungeonInstance.instanceId.find(instanceId);
  if (!inst) return null;
  return DUNGEONS_BY_ID[inst.dungeonId] ?? null;
}

/**
 * `tickMobAI`'s interior-nav gate: the grids a mob whose instance resolves to
 * `dungeon` must be stepped against. Takes the already-resolved DungeonDef
 * because that caller needs it for boss mechanics anyway and must not pay a
 * second `dungeonInstance` read.
 */
export function interiorNavForDungeon(dungeon: DungeonDef | null): DungeonInteriorNav | null {
  return dungeon ? dungeonInteriorNavFor(dungeon.id) : null;
}

/**
 * `movePlayer`'s interior-nav gate: the grids a player inside
 * `dungeonInstanceId` must be resolved against, straight from the instance row.
 *
 * Null for an outdoor player (instance 0), a stale instance id, a dungeon the
 * content package no longer ships, and a dungeon with no interior row — every
 * one of which means "skip interior rules", never "use Castle Ashwood's".
 * Hardcoding either caller back to one dungeon's descriptor reinstates the
 * original R21 bug, so this is pinned both behaviourally (here) and
 * structurally against the reducer bodies (dungeonInteriorNav.test.ts).
 */
export function interiorNavForInstance(
  ctx: DungeonInstanceLookup,
  dungeonInstanceId: bigint,
): DungeonInteriorNav | null {
  return interiorNavForDungeon(getDungeonForInstance(ctx, dungeonInstanceId));
}

/**
 * Dungeon interior-local meters (e.g. castlePlan LOCAL space) → STDB px,
 * resolved against the OWNING dungeon's own zone (its
 * DungeonDef.entrance.zoneId) and its own registered anchor above — not
 * always zone 1's origin plus Ashwood's anchor.
 *
 * Before this fix this folded CASTLE_INTERIOR_ANCHOR against WORLD_CENTER_PX
 * unconditionally, i.e. implicitly zone 1's origin, for every dungeon's
 * interior. zoneEntranceToPx's own doc comment already tells this story for
 * the entrance side; this was the interior side of the same bug, and it
 * survived D156 (D173 item 2).
 *
 * A dungeon with no registered entry falls back to Ashwood's anchor —
 * matching this function's exact pre-fix behaviour, since there is no
 * second entry to fall back to correctly yet and this PR (pure
 * parameterization) adds none.
 */
export function interiorLocalToPx(
  dungeon: DungeonDef,
  local: { x: number; z: number },
): { x: number; y: number } {
  const anchor = DUNGEON_INTERIOR_ENTRY[dungeon.id]?.anchor ?? CASTLE_INTERIOR_ANCHOR;
  return contentPosToPx(dungeon.entrance.zoneId, {
    x: local.x + anchor.x,
    z: local.z + anchor.z,
  });
}

/**
 * The overworld px the dungeon's gate stands on.
 *
 * This used to inline its own origin-offset arithmetic as
 * `const ox = zoneId === 1 ? 0 : 0;` — both branches zero, so every dungeon
 * resolved against zone 1's origin no matter which zone its entrance named,
 * and a zone-2 dungeon's gate would have landed ~3000 m away inside zone 1.
 * It now defers to the one copy of that math in world/zones.ts, which reads
 * the offset from the manifest.
 */
export function zoneEntranceToPx(dungeon: DungeonDef): { x: number; y: number } {
  const { zoneId, pos } = dungeon.entrance;
  return contentPosToPx(zoneId, pos);
}

/**
 * Where entering `dungeon` teleports the player: its own registered interior
 * spawn point, or its outdoor gate when no interior entry is registered for
 * it yet.
 *
 * Replaces index.ts's own
 * `dungeonId === 'castle_ashwood' ? castleSpawnPx() : gatePx` (D174 item 1)
 * — the same fallback-to-gate behaviour, now decided by whether interior
 * data exists for the dungeon actually being entered, not by a literal
 * string compare against one dungeon's id.
 */
export function dungeonSpawnPx(dungeon: DungeonDef): { x: number; y: number } {
  const entry = DUNGEON_INTERIOR_ENTRY[dungeon.id];
  if (!entry) return zoneEntranceToPx(dungeon);
  return interiorLocalToPx(dungeon, entry.spawnLocal);
}

/**
 * Where the interior exit hotspot sits for `dungeon` — the point
 * `leaveDungeon` checks proximity against before teleporting back outside.
 *
 * Replaces index.ts's unconditional `castleExitHotspotPx()` (D174 item 2),
 * which ejected a player leaving ANY dungeon instance at Castle Ashwood's
 * gate in zone 1.
 */
export function dungeonExitHotspotPx(dungeon: DungeonDef): { x: number; y: number } {
  const entry = DUNGEON_INTERIOR_ENTRY[dungeon.id];
  if (!entry) return zoneEntranceToPx(dungeon);
  return interiorLocalToPx(dungeon, entry.exitHotspotLocal);
}

export function spawnInstanceOffsetM(i: number, radiusM: number): { dx: number; dz: number } {
  const angle = i * 2.399963;
  const r = radiusM * (0.35 + 0.65 * ((i % 5) / 5));
  return { dx: Math.cos(angle) * r, dz: Math.sin(angle) * r };
}

export function distSqPx(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * netId → the walkable floor Y its room sits on, for every dungeon.
 *
 * Built from each dungeon's OWN generated roomId → floor-Y table. Keying on
 * netId alone is safe because netIds are globally unique (`ca_*` / `bd_*`,
 * and dungeonSpawnByNetId above already assumes it); what is NOT safe is
 * resolving a Barrowdeep netId against CASTLE_ROOM_FLOOR_Y, which is why this
 * is two sources merged rather than one table with a widening fallback.
 *
 * The two dungeons agree on both level heights by construction (D171 reuses
 * Castle Ashwood's level Y verbatim), so the shared default below is right for
 * both — but the per-dungeon tables are what actually decide it.
 */
const dungeonSpawnFloorByNetId = new Map<string, number>([
  ...CASTLE_ASHWOOD_SPAWNS.map((s) => [
    s.netId,
    CASTLE_ROOM_FLOOR_Y[s.roomId as keyof typeof CASTLE_ROOM_FLOOR_Y] ?? CASTLE_LEVELS[1].y,
  ] as [string, number]),
  ...BARROWDEEP_SPAWNS.map((s) => [
    s.netId,
    BARROWDEEP_ROOM_FLOOR_Y[s.roomId as keyof typeof BARROWDEEP_ROOM_FLOOR_Y] ?? BARROWDEEP_LEVELS[1].y,
  ] as [string, number]),
]);

/** Walkable floor Y (world meters) for a dungeon spawn netId. */
export function dungeonSpawnFloorYM(netId: string): number {
  return dungeonSpawnFloorByNetId.get(netId) ?? CASTLE_LEVELS[1].y;
}
