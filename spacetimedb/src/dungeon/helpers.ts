/**
 * Dungeon instance helpers — server-side px/coord + spawn indexing.
 * Mirrors src/features/world/castle/castleDungeon.js.
 */

import { MOBS } from '../content/index.js';
import { DUNGEONS } from '../content/dungeons/index.js';
import { CASTLE_ASHWOOD_ENTRY, CASTLE_ASHWOOD_SPAWNS } from '../content/dungeons/castleAshwood.generated.js';
import { BARROWDEEP_ENTRY, BARROWDEEP_INTERIOR_ANCHOR, BARROWDEEP_SPAWNS } from '../content/dungeons/barrowdeep.generated.js';
import { BARROWDEEP_LEVELS, BARROWDEEP_ROOM_FLOOR_Y } from '../barrowdeep/navGrids.js';
import { CASTLE_LEVELS, CASTLE_ROOM_FLOOR_Y } from '../castle/navGrids.js';
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
   * True when this dungeon's interior walls resolve against
   * castle/navGrids.ts's bitmaps specifically.
   *
   * Placement (anchor/spawn/exit, above) and wall collision are two different
   * questions, and before a second dungeon existed one field answered both.
   * The Barrowdeep answers them differently: its placement is fully resolved
   * (its own anchor, its own zone), but its nav bitmaps live in
   * barrowdeep/navGrids.ts and castle/surface.ts's scan closes over
   * CASTLE_NAV_META / CASTLE_LEVELS / CASTLE_STAIRS, so it cannot read them.
   * Answering "yes" here would resolve every step taken inside the Barrowdeep
   * against Castle Ashwood's walls, ~3 km away in another zone — exactly the
   * silent wrongness D174 item 3 exists to prevent.
   */
  castleNavBitmaps: boolean;
}

export const DUNGEON_INTERIOR_ENTRY: Record<string, DungeonInteriorEntry> = {
  castle_ashwood: {
    anchor: CASTLE_INTERIOR_ANCHOR,
    spawnLocal: CASTLE_ASHWOOD_ENTRY.spawnLocal,
    exitHotspotLocal: CASTLE_ASHWOOD_ENTRY.exitHotspotLocal,
    castleNavBitmaps: true,
  },
  barrowdeep: {
    // Zone-local to zone 2 (D175). Imported from the generated plan rather
    // than re-typed the way CASTLE_INTERIOR_ANCHOR is, so the emitter is the
    // only thing that can move it.
    anchor: BARROWDEEP_INTERIOR_ANCHOR,
    spawnLocal: BARROWDEEP_ENTRY.spawnLocal,
    exitHotspotLocal: BARROWDEEP_ENTRY.exitHotspotLocal,
    // See the field's doc comment: the Barrowdeep's own bitmaps are emitted
    // and committed at barrowdeep/navGrids.ts, but nothing reads them yet.
    // Interior wall collision inside the Barrowdeep is therefore NOT enforced
    // server-side; movePlayer falls through to the outdoor px clamp, which
    // zone 2's raised 500 m box (D175) now contains the whole interior
    // footprint of, so no step inside it is clamped or rejected.
    castleNavBitmaps: false,
  },
};

/**
 * True when `dungeonId`'s interior resolves against the CASTLE nav bitmaps.
 * False for any other id — including a registered dungeon whose bitmaps live
 * elsewhere, and including a real dungeon with no row here at all — rather
 * than assuming every dungeon instance is Castle Ashwood's (D174 item 3).
 */
export function dungeonUsesCastleInteriorNav(dungeonId: string): boolean {
  return DUNGEON_INTERIOR_ENTRY[dungeonId]?.castleNavBitmaps === true;
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
