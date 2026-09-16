/**
 * Dungeon instance helpers — server-side px/coord + spawn indexing.
 * Mirrors src/features/world/castle/castleDungeon.js.
 */

import { MOBS } from '../content/index.js';
import { DUNGEONS } from '../content/dungeons/index.js';
import { CASTLE_ASHWOOD_ENTRY, CASTLE_ASHWOOD_SPAWNS } from '../content/dungeons/castleAshwood.generated.js';
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

export function interiorLocalToPx(local: { x: number; z: number }): { x: number; y: number } {
  return {
    x: Math.round((local.x + CASTLE_INTERIOR_ANCHOR.x) * PX_PER_M + WORLD_CENTER_PX),
    y: Math.round((local.z + CASTLE_INTERIOR_ANCHOR.z) * PX_PER_M + WORLD_CENTER_PX),
  };
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

export function castleSpawnPx(): { x: number; y: number } {
  return interiorLocalToPx(CASTLE_ASHWOOD_ENTRY.spawnLocal);
}

export function castleExitHotspotPx(): { x: number; y: number } {
  return interiorLocalToPx(CASTLE_ASHWOOD_ENTRY.exitHotspotLocal);
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

const dungeonSpawnFloorByNetId = new Map<string, number>(
  CASTLE_ASHWOOD_SPAWNS.map((s) => [
    s.netId,
    CASTLE_ROOM_FLOOR_Y[s.roomId as keyof typeof CASTLE_ROOM_FLOOR_Y] ?? CASTLE_LEVELS[1].y,
  ]),
);

/** Walkable floor Y (world meters) for a castle dungeon spawn netId. */
export function dungeonSpawnFloorYM(netId: string): number {
  return dungeonSpawnFloorByNetId.get(netId) ?? CASTLE_LEVELS[1].y;
}
