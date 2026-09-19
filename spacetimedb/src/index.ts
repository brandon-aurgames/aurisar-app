/**
 * Aurisar World — SpacetimeDB Server Module
 *
 * This module is the authoritative server for the Aurisar 2D multiplayer world.
 * It stores all player positions, handles movement validation, and manages chat.
 *
 * Deploy:  spacetime publish --server mainnet aurisar-world
 * Regen:   spacetime generate --lang typescript --out-dir ../src/features/world/module_bindings
 *
 * Coordinate system — the client's single source of truth is
 * src/features/world/worldSpace.js (PX_PER_M, WORLD_ORIGIN_PX, toWorld/toStdb);
 * these MUST stay in sync with it:
 *   STDB px → world units:   (px - 1600) / 32     (client toWorld)
 *   world units → STDB px:   units * 32 + 1600    (client toStdb)
 *   Spawn at STDB (1600, 1600) = world origin.
 *
 * Server MOVEMENT bounds are PER-ZONE and derived from the content manifest —
 * see world/zones.ts, which owns both the bounds and the px → zone mapping.
 * Each zone gets a square box of ZoneDef.boundsHalfExtentM (default 1000 m)
 * around its originOffsetM, less a 32 px (= 1 world unit) player half-width.
 * Zone 1 sits at the origin and does not set the field, so its box is
 * [-30368, 33568] on both axes — exactly the single global clamp this
 * replaced. The tiling grid (world_build_config.tiling_streaming.
 * world_bounds_m) spans -1000..+1048 m (8 × 256); both comfortably contain the
 * ~520 m playable disc, so the difference is not player-visible. The
 * px/meter/origin constants mirror src/features/world/worldSpace.js (client
 * source of truth).
 */

import { schema, table, t } from 'spacetimedb/server';
import { Identity, ScheduleAt } from 'spacetimedb';
import {
  CLASS_IDS,
  MOBS,
  NPCS,
  QUESTS,
  SPAWNS,
  WAYPOINTS,
} from './content/index.js';
import type { DungeonDef, MobDef, QuestDef, QuestObjective, SpawnDef } from './content/types.js';
import { worldLevelFromFitnessXp } from './content/formulas/xp.js';
import {
  DUNGEONS_BY_ID,
  DUNGEON_EXIT_RANGE_PX,
  DUNGEON_GATE_RANGE_PX,
  DUNGEON_MAX_PLAYERS,
  distSqPx,
  dungeonExitHotspotPx,
  dungeonSpawnByNetId,
  dungeonSpawnPx,
  dungeonInteriorNavFor,
  getDungeonForInstance,
  interiorLocalToPx,
  interiorNavForDungeon,
  interiorNavForInstance,
  zoneEntranceToPx,
  dungeonSpawnFloorYM,
  type DungeonSpawnEntry,
} from './dungeon/helpers.js';
import {
  bossAoeRadiusPx,
  bossDamageMult,
  bossEnraged,
  bossMechanicsFor,
  shouldBossAoePulse,
} from './dungeon/bossMechanics.js';
import {
  interiorFloorYAtPx,
  interiorMobStepPx,
  resolveInteriorStep,
  type DungeonInteriorNav,
} from './dungeon/interiorNav.js';
import { sameInteriorFloor } from './castle/validate.js';
import {
  addCopper,
  addItemStack,
  applyHeal,
  countItemOwned,
  deductCopper,
  getOrCreateWallet,
  grantQuestReward,
  grantStartingKit,
  isConsumable,
  removeItemStack,
  type InventoryCtx,
} from './inventory/helpers.js';
import {
  consumeCollectObjectives,
  effectiveQuestCounts,
  parseQuestCounts,
  questReadyWithInventory,
  refreshCollectQuestProgress,
} from './quests/collect.js';
import { objectiveTarget } from './content/formulas/quests.js';
import { getItemDef, ITEMS } from './content/items/index.js';
import {
  buyPriceCopper,
  clampTradeQty,
  isVendorNpc,
  itemSellPrice,
  playerNearNpc,
  vendorSellsItem,
} from './vendors/helpers.js';
import {
  cookRecipeForPlayer,
  openChestForPlayer,
  playerNearLitCampfire,
} from './world/chest.js';
import { clampMoveToMaxSpeed } from './world/moveGuard.js';
import { contentPosToPx, resolveZone, WORLD_ORIGIN_PX } from './world/zones.js';
import { resolveGateTravel } from './world/travel.js';
import {
  equipItemForPlayer,
  unequipSlotForPlayer,
} from './equip/helpers.js';
import { applyMobKill, clearMobAuras } from './combat/kill.js';
import {
  COMBAT_EVENT_TTL_MICROS,
  emitCombatEvent,
  logCombat,
  type CombatEventKind,
} from './combat/events.js';
import {
  advanceTick,
  applyResolvedAuras,
  auraStatBonuses,
  AURA_TICK_MICROS,
  buffedAttributes,
  consumeAbsorb,
  movementRestriction,
  partitionAuraWork,
} from './combat/auras.js';
import {
  abilityById,
  buildCasterState,
  buildTargetState,
  equippedSnapshot,
  maxResourceFrom,
  parseCooldowns,
  regeneratedResource,
  resourceMaxFor,
  serializeCooldowns,
} from './combat/state.js';
import {
  resolveCast,
  validateCast,
} from './content/formulas/abilityResolve.js';
import { mulberry32, seedFrom } from './content/formulas/combat.js';

// World bounds are per-zone and content-derived — see world/zones.ts. The
// constants that used to live here (WORLD_HALF_PX / WORLD_CENTER_PX /
// PLAYER_HALF_PX / WORLD_MIN_PX / WORLD_MAX_PX) described one global box
// around the origin; WORLD_ORIGIN_PX is imported from that module now.

// ── Slice 5c combat / AI constants ───────────────────────────────────────────
//
// 1 world meter = 32 STDB px. All radii / speeds below are derived from
// gameplay-level numbers (m, s) at module load so the units stay readable.

const PX_PER_M                  = 32;
const AI_TICK_MICROS            = 250_000n;   // 4 Hz mob AI tick
const AI_TICK_DT_SEC            = 0.25;
const WOLF_MELEE_RANGE_PX       = 2 * PX_PER_M;       // 2 m melee range (all mob types, until P3)
// Legacy column defaults — the mob table's ADD COLUMN defaults were
// published with these values; they must not change (migration contract).
// Live stats now come from the content package per mobType.
const SEED_WOLF_AGGRO_M         = 18;
const SEED_WOLF_LEASH_M         = 35;
const SEED_WOLF_RESPAWN_SEC     = 25;

const PLAYER_MAX_HP             = 100;
const PLAYER_RESPAWN_MICROS     = 5_000_000n;         // 5 s death timer before snap to origin

// ── P1 quests / NPCs ─────────────────────────────────────────────────────────
const INTERACT_RANGE_PX         = 6 * PX_PER_M;       // talk/accept/turn-in must be within 6 m of the NPC
const QUEST_STATE_ACTIVE        = 0;
const QUEST_STATE_READY         = 1;
const QUEST_STATE_DONE          = 2;

// ── Campfires ────────────────────────────────────────────────────────────────
//
// Players can build a campfire in front of them (prototype buildFire ~3008).
// Fires are shared world state: every client renders every burning fire.

const CAMPFIRE_WOOD_COST          = 3;
const CAMPFIRE_BURN_MICROS      = 180_000_000n;       // fires burn for 3 minutes
const CAMPFIRE_COOLDOWN_MICROS  = 10_000_000n;        // min 10 s between builds per player
const CAMPFIRE_MAX_PER_PLAYER   = 3;                  // oldest is snuffed when exceeded
const CAMPFIRE_PLACE_RANGE_PX   = 3 * PX_PER_M;       // must be placed within 3 m of the builder

// ── Spawn-point index for O(1) respawn lookups ───────────────────────────────
//
// `respawnMob` needs the original spawn point's world position + radii. Each
// mob row stores its spawn metadata directly (spawnX/Y, aggro/leash, respawnSec)
// so the AI tick is self-contained, but on respawn we need the *spawn point's*
// values again to insert a fresh row.
//
// P1: the seeding source is the shared content package (SPAWNS + MOBS in
// src/content/, mirrored from src/features/world/content/) — tile-JSON spawns
// (gameplay/) are retired; seedWorld's self-heal pass deletes their live rows
// because their netIds no longer appear in this map.

interface SpawnEntry {
  spawn:         SpawnDef;
  mobDef:        MobDef;
  instanceIndex: number;
}
const spawnByNetId = new Map<string, SpawnEntry>();
for (const spawn of SPAWNS) {
  const mobDef = MOBS[spawn.mobType];
  if (!mobDef) continue; // validateContent() catches this at authoring time
  for (let i = 0; i < spawn.count; i++) {
    spawnByNetId.set(`${spawn.netId}_${i}`, { spawn, mobDef, instanceIndex: i });
  }
}

/**
 * Deterministic scatter for the i-th instance of a spawn family — a
 * golden-angle ring inside the camp radius. No RNG (reducers must stay
 * deterministic), but instances spread instead of stacking on one point.
 */
function spawnInstanceOffsetM(i: number, radiusM: number): { dx: number; dz: number } {
  const angle = i * 2.399963; // golden angle in radians
  const r = radiusM * (0.35 + 0.65 * ((i % 5) / 5));
  return { dx: Math.cos(angle) * r, dz: Math.sin(angle) * r };
}

// ── Scheduled-table row builders ─────────────────────────────────────────────
//
// SpacetimeDB requires that a scheduled reducer's single positional argument
// reference the *same* row product type as the table that fires it. We
// declare each row's shape via `t.row(...)` once here, then pass the SAME
// builder to both the `table()` definition and the reducer's params object.
// Without this, the build emits:
//   "Scheduled reducer X expected to have type (0: &N), but has type (col1, col2, ...)"

const mobAiTickScheduleRow = t.row('MobAiTickScheduleRow', {
  id:          t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

const mobRespawnQueueRow = t.row('MobRespawnQueueRow', {
  id:          t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
  spawnNetId:  t.string(),
  dungeonInstanceId: t.u64().default(0n),
});

const playerRespawnQueueRow = t.row('PlayerRespawnQueueRow', {
  id:          t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
  identity:    t.identity(),   // payload — which player to revive
});

const campfireExpireQueueRow = t.row('CampfireExpireQueueRow', {
  id:          t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
  campfireId:  t.u64(),        // payload — which fire burns out
});

// ── M6 combat schedules ──────────────────────────────────────────────────────
// Both are Interval rows: they stay in their table and re-fire forever.

const auraTickScheduleRow = t.row('AuraTickScheduleRow', {
  id:          t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

const combatEventReapScheduleRow = t.row('CombatEventReapScheduleRow', {
  id:          t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

const spacetimedb = schema({

  /**
   * One row per connected (or previously connected) player.
   * Identity is the SpacetimeDB connection key — unique per client.
   */
  player: table(
    { public: true },
    {
      // Original columns — order MUST match the deployed maincloud schema.
      // SpacetimeDB treats column reordering on a live table as a manual
      // migration. New columns get appended below with .default(...) so
      // existing rows backfill non-destructively.
      identity:     t.identity().primaryKey(),  // primary key — SpacetimeDB connection identity
      username:     t.string(),     // display name from Aurisar profile
      classType:    t.string(),     // 'warrior' | 'mage' | 'archer' | 'rogue'
      avatarColor:  t.string(),     // hex color string for the player marker
      x:            t.f32(),        // world X position (pixels)
      y:            t.f32(),        // world Y position (pixels)
      direction:    t.u8(),         // 0=down 1=up 2=left 3=right
      isMoving:     t.bool(),       // for animation state
      // Content ZoneDef.id of the zone this player is standing in (D157).
      // Previously a separate hub/training/plaza scheme produced by
      // detectZone's hardcoded pixel rectangles; nothing read those values, so
      // the column was repurposed in place — same t.u8(), same position, no
      // ADD COLUMN and no manual migration. Indexed because the zone-scoped
      // player subscription filters on it.
      zoneId:       t.u8().index('btree'),
      online:       t.bool(),       // true while connection is active
      // Appended columns — declared after the originals so the live table
      // gets ADD COLUMN semantics, not a manual reorder migration.
      avatarConfig: t.string().default(''),       // JSON-encoded AvatarConfig; default '' on backfill — client re-syncs via setPlayerInfo on next login
      lastChatAt:   t.u64().default(0n),          // micros since unix epoch of last sendChat — default 0n behaves correctly with the > 0n rate-limit guard
      lastAttackAt: t.u64().default(0n),          // micros since unix epoch of last castAbility — server-enforced melee cooldown (see castAbility reducer)
      // ── Slice 5c additions (must stay at end) ──
      hp:           t.i32().default(PLAYER_MAX_HP),   // current HP; 0 = dead
      maxHp:        t.i32().default(PLAYER_MAX_HP),   // max HP for HP-bar normalization
      deadUntil:    t.u64().default(0n),              // 0 = alive; otherwise micros-since-epoch when respawn fires
      dungeonInstanceId: t.u64().default(0n),        // 0 = overworld; else active dungeon instance
      floorYM:      t.f32().default(0),              // castle interior vertical meters (world Y)
      // ── Batch E additions (appended; ADD COLUMN semantics) ──
      lastMoveAt:   t.u64().default(0n),             // micros of last accepted movePlayer — server-side move-rate floor (movement was the one hot reducer with NO throttle; chat and attack both have one)
      // ── M6 combat additions (appended; ADD COLUMN semantics, D84) ──
      // These four MUST remain the last four columns of this table. Anything
      // inserted above them reorders the live maincloud schema, which
      // SpacetimeDB treats as a manual migration rather than an ADD COLUMN.
      resource:     t.f32().default(0),              // current rage / mana / energy; backfills to 0 and is refilled to resourceMax on the next connect
      resourceMax:  t.f32().default(0),              // deriveStats(...).maxResource — recomputed on connect and on each cast (equip changes it)
      lastGcdAt:    t.u64().default(0n),             // micros when the global cooldown FREES (not the last cast time — matches CasterState.lastGcdAtMicros)
      abilityCooldowns: t.string().default(''),      // compact JSON {abilityId: microsWhenReady}; '' = nothing on cooldown. See combat/state.ts for why this is a field and not a table.
      lastRegenAt:  t.u64().default(0n),             // micros of the last resource settlement; regen is computed lazily from this on the next cast (D94). MUST stay the last column.
    }
  ),

  /**
   * World / proximity chat messages.
   * Clients subscribe to all, but filter proximity client-side (< 400px distance).
   */
  chatMessage: table(
    { public: true },
    {
      id:          t.u64(),        // auto-incremented via timestamp
      senderId:    t.identity(),   // who sent it
      senderName:  t.string(),     // denormalized username for easy display
      text:        t.string(),     // message body (max 280 chars enforced below)
      sentAt:      t.u64(),        // Unix ms timestamp
      msgType:     t.string(),     // 'world' | 'proximity' | 'emote'
      x:           t.f32(),        // sender position at send time (proximity filter)
      y:           t.f32(),
    }
  ),

  /**
   * Server-authoritative mob entities.
   *
   * mob_id uses the same timestamp-as-unique-id pattern as chatMessage.
   * Position is in STDB px (same coord system as player).
   * hp/maxHp are i32 so damage math can briefly go negative before being
   * clamped — UI treats hp<=0 as dead.
   *
   * Slice 5c additions store per-mob AI state directly on the row so
   * `tickMobAI` doesn't need to join against tileGameplay every tick.
   */
  mob: table(
    { public: true },
    {
      mobId:       t.u64().primaryKey(),
      mobType:     t.string(),     // 'wolf' for now
      x:           t.f32(),
      y:           t.f32(),
      hp:          t.i32(),
      maxHp:       t.i32(),
      state:       t.string(),     // 'alive' | 'returning' (we delete on death, no 'dead' state)
      spawnNetId:  t.string(),     // matches tile_gameplay net_id when seeded from JSON; '' when hardcoded
      // ── Slice 5c additions (must stay at end) ──
      spawnX:        t.f32().default(0),         // home position X (STDB px) — leash anchor
      spawnY:        t.f32().default(0),         // home position Y (STDB px)
      aggroRadiusPx: t.f32().default(SEED_WOLF_AGGRO_M * PX_PER_M),     // 576 default (18 m × 32)
      leashRadiusPx: t.f32().default(SEED_WOLF_LEASH_M * PX_PER_M),     // 1120 default (35 m × 32)
      respawnSec:    t.u32().default(SEED_WOLF_RESPAWN_SEC),            // delay between death and respawn insert
      lastAttackAt:  t.u64().default(0n),                               // micros since epoch of last bite (cooldown enforcement)
      dungeonInstanceId: t.u64().default(0n),                            // 0 = overworld mob; else instance-scoped
      floorYM:       t.f32().default(0),                                 // interior world Y (m); 0 = overworld
      spawnedAt:     t.u64().default(0n),                                // boss spawn micros (instance bosses)
      lastAoeAt:     t.u64().default(0n),                                // last aoePulse micros
      enraged:       t.bool().default(false),                            // enrage multiplier active
    }
  ),

  /**
   * Slice 5c — scheduled tables.
   *
   * SpacetimeDB v2.2.0 fires the bound reducer for each row at `scheduledAt`.
   * If `scheduledAt` is an Interval, the row stays in the table and re-fires
   * forever. If it's a Time, the row fires once and is deleted.
   *
   * All three are private (default — no `public: true`) since they are
   * server-only bookkeeping; clients never need to see them.
   *
   * Scheduled-reducer contract: the bound reducer takes a SINGLE positional
   * arg of the table's row type (the SpacetimeDB Rust-side validator emits
   * "expected (0: &N)" if you spread the columns). We use `t.row(...)`
   * builders defined above so the table and reducer share one product type.
   */
  mobAiTickSchedule: table(
    { scheduled: (): any => tickMobAI },
    mobAiTickScheduleRow,
  ),

  mobRespawnQueue: table(
    { scheduled: (): any => respawnMob },
    mobRespawnQueueRow,
  ),

  playerRespawnQueue: table(
    { scheduled: (): any => respawnPlayer },
    playerRespawnQueueRow,
  ),

  /**
   * Player-built campfires — shared world dressing with a burn timer.
   * Clients render every row (log pile + stones + flame light) and remove
   * it when the scheduled expiry deletes the row.
   */
  campfire: table(
    { public: true },
    {
      campfireId: t.u64().primaryKey(),
      ownerId:    t.identity(),    // who built it
      ownerName:  t.string(),      // denormalized for "X's campfire" UI
      x:          t.f32(),         // STDB px (same coord system as player)
      y:          t.f32(),
      litAt:      t.u64(),         // micros since epoch — also the per-player build cooldown anchor
      expiresAt:  t.u64(),         // micros since epoch when expireCampfire fires
    }
  ),

  campfireExpireQueue: table(
    { scheduled: (): any => expireCampfire },
    campfireExpireQueueRow,
  ),

  /**
   * P1 — per-player quest progress. One row per (player, quest) pair from
   * acceptance onward; rows persist after completion so prerequisites and
   * once-only acceptance can be checked.
   *
   * state: 0 = active, 1 = ready (objectives met, awaiting turn-in),
   *        2 = done (turned in).
   * countsJson: JSON array parallel to the QuestDef.objectives array,
   *        e.g. '[3,0]'. Kill counts increment in castAbility's kill path;
   *        find objectives flip 0→1 in reachWaypoint.
   *
   * Public: clients subscribe and filter to their own identity (same
   * trust posture as the player table at this scale). Lookups iterate —
   * row count stays tiny (players × quests in a zone).
   */
  playerQuest: table(
    { public: true },
    {
      id:         t.u64().primaryKey().autoInc(),
      owner:      t.identity(),
      questId:    t.string(),
      state:      t.u8(),
      countsJson: t.string(),
      acceptedAt: t.u64(),
    }
  ),

  /**
   * Active dungeon instances (Castle Ashwood v2). Mobs and players reference
   * instanceId; rows are deleted when the last member leaves.
   */
  dungeonInstance: table(
    { public: true },
    {
      instanceId: t.u64().primaryKey().autoInc(),
      dungeonId:  t.string(),
      createdAt:  t.u64(),
    }
  ),

  /**
   * P2 — fitness XP mirror for world level gating. Private: raw XP stays
   * server-side; clients derive level locally from profile XP on connect.
   */
  playerProgress: table(
    {},
    {
      identity:            t.identity().primaryKey(),
      fitnessXp:           t.u64().default(0n),
      fitnessXpBaseline:   t.u64().default(0n),
      worldLevel:          t.u32().default(1),
    }
  ),

  /**
   * P4 — copper wallet per player. Public so the client can show balance;
   * `imported` gates the one-time localStorage migration reducer.
   */
  playerWallet: table(
    { public: true },
    {
      identity: t.identity().primaryKey(),
      copper:   t.u64().default(0n),
      imported: t.bool().default(false),
    }
  ),

  /**
   * P4 — item stacks owned by a player. One row per stack (stackable items
   * may share itemId across rows when over stack cap). Clients filter to
   * their own identity.
   */
  playerItemStack: table(
    { public: true },
    {
      id:       t.u64().primaryKey().autoInc(),
      owner:    t.identity(),
      itemId:   t.string(),
      quantity: t.u32(),
    }
  ),

  /**
   * P4 phase 4 — world chests already looted by a player (chest index from
   * worldgen). Prevents re-farming across reloads.
   */
  playerChestOpened: table(
    { public: true },
    {
      id:      t.u64().primaryKey().autoInc(),
      owner:   t.identity(),
      chestId: t.u32(),
    }
  ),

  /**
   * P4 phase 5 — equipped weapon/armor slots per player. Items leave the
   * bag while equipped; unequip returns them to player_item_stack.
   */
  playerEquipped: table(
    { public: true },
    {
      id:     t.u64().primaryKey().autoInc(),
      owner:  t.identity(),
      slot:   t.string(),
      itemId: t.string(),
    }
  ),

  /**
   * M6 — timed effects on a player (D86). New tables are additive, so unlike
   * the `player` append they carry no column-order migration risk.
   *
   * `magnitude` units depend on `effectKind` — per-tick HP for dot/hot, an HP
   * pool for absorb, a flat stat delta for buffs, and a PERCENT (0-90) for
   * slow. See combat/auras.ts, which is the only writer.
   */
  playerAura: table(
    { public: true },
    {
      id:         t.u64().primaryKey().autoInc(),
      owner:      t.identity(),   // who carries the aura
      abilityId:  t.string(),     // source ability; (owner, abilityId, effectKind) is the refresh key
      effectKind: t.string(),     // one of the 12 AbilityEffect kinds
      stat:       t.string(),     // buff target stat; '' when not a stat buff
      magnitude:  t.f32(),
      expiresAt:  t.u64(),        // micros since epoch
      nextTickAt: t.u64(),        // micros since epoch; 0 = non-ticking aura
      tickSec:    t.f32(),        // 0 = non-ticking aura
    }
  ),

  /**
   * M6 — the same, carried by a mob instead of a player (D86).
   *
   * M9-6 appends `appliedBy`: a mob aura has no owner (it belongs to the mob),
   * so a dot that killed its host named no player and the kill credited
   * nobody — the gap `tickAuras` used to carry a comment about. The column is
   * APPENDED, never inserted mid-list, and carries `.default(Identity.zero())`
   * so rows written by the pre-M9-6 module backfill rather than failing the
   * publish. A zero identity reads as "nobody applied this", which is exactly
   * what those rows mean, and the kill path falls back to the old
   * no-credit behaviour for them.
   */
  mobAura: table(
    { public: true },
    {
      id:         t.u64().primaryKey().autoInc(),
      mobId:      t.u64(),
      abilityId:  t.string(),
      effectKind: t.string(),
      stat:       t.string(),
      magnitude:  t.f32(),
      expiresAt:  t.u64(),
      nextTickAt: t.u64(),
      tickSec:    t.f32(),
      // Appended in M9-6 — must stay LAST. See the note above.
      appliedBy:  t.identity().default(Identity.zero()),
    }
  ),

  /**
   * M6 — combat feedback channel (D87, §2.6). Every hit, crit, miss, dodge,
   * kill, heal, aura application AND every rejection reason lands here, so the
   * client never infers damage from an `hp` delta: two players hitting one mob
   * make that delta ambiguous, and miss/dodge do not change hp at all.
   *
   * Rows live 5 s; `reapCombatEvents` deletes the rest.
   */
  combatEvent: table(
    { public: true },
    {
      id:          t.u64().primaryKey().autoInc(),
      at:          t.u64(),       // micros since epoch
      actor:       t.identity(),  // the caster
      abilityId:   t.string(),    // '' for the castAbility melee fallback
      targetMobId: t.u64(),       // 0 = self-cast / no target
      kind:        t.string(),    // see COMBAT_EVENT_KINDS in combat/events.ts
      amount:      t.i32(),       // damage / heal / absorb; 0 when not applicable
      reason:      t.string(),    // CastRejection string when kind === 'rejected', else ''
    }
  ),

  /**
   * M6 scheduled tables. Private (server bookkeeping) and, being scheduled,
   * not client-reachable — so neither enters the D27 reducer binding surface.
   */
  auraTickSchedule: table(
    { scheduled: (): any => tickAuras },
    auraTickScheduleRow,
  ),

  combatEventReapSchedule: table(
    { scheduled: (): any => reapCombatEvents },
    combatEventReapScheduleRow,
  ),

});

export default spacetimedb;

// ─────────────────────────────────────────────────────────────────────────────
// REDUCERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called once when a player enters the world.
 * Sets their display name and class — links their Aurisar identity to the session.
 */
export const setPlayerInfo = spacetimedb.reducer(
  {
    username:     t.string(),
    classType:    t.string(),
    avatarColor:  t.string(),
    avatarConfig: t.string(),
  },
  (ctx, { username, classType, avatarColor, avatarConfig }) => {
    const identity = ctx.sender;

    // Validate inputs. Class ids come from the shared content package —
    // the same 11 Aurisar classes the fitness app defines.
    const safeName = username.trim().slice(0, 32) || 'Adventurer';
    const safeClass = (CLASS_IDS as string[]).includes(classType)
      ? classType
      : 'warrior';
    const safeAvatarConfig = avatarConfig.length <= 4096 ? avatarConfig : '';

    const existing = ctx.db.player.identity.find(identity);
    if (existing) {
      // Preserve existing HP / death state — re-login while dead leaves them
      // dead; the queued respawn reducer will still fire at the original
      // deadline. Re-login while alive keeps current HP.
      ctx.db.player.identity.update({
        ...existing,
        username: safeName,
        classType: safeClass,
        avatarColor,
        avatarConfig: safeAvatarConfig,
        online: true,
      });
    } else {
      // Spawn at the world origin (zone 1's own origin, for now — ZoneDef's
      // spawnPos is still unread; see manifest.ts).
      ctx.db.player.insert({
        identity,
        username: safeName,
        classType: safeClass,
        avatarColor,
        avatarConfig,
        x: WORLD_ORIGIN_PX,
        y: WORLD_ORIGIN_PX,
        direction: 0,
        isMoving: false,
        zoneId: resolveZone(WORLD_ORIGIN_PX, WORLD_ORIGIN_PX).zoneId,
        online: true,
        lastChatAt: 0n,
        lastAttackAt: 0n,
        // Seeded, not 0: the move guard measures from this, and a fresh row
        // with no baseline would owe its first move an unbounded allowance.
        lastMoveAt: ctx.timestamp.microsSinceUnixEpoch,
        hp: PLAYER_MAX_HP,
        maxHp: PLAYER_MAX_HP,
        deadUntil: 0n,
        dungeonInstanceId: 0n,
        floorYM: 0,
        // M6: a brand-new row starts with an empty pool; clientConnected fills
        // it once the starting kit is equipped and deriveStats has gear to
        // read, and lazy regen (D94) tops it up from there.
        resource: 0,
        resourceMax: 0,
        lastGcdAt: 0n,
        abilityCooldowns: '',
        lastRegenAt: 0n,
      });
      const invCtx = ctx as InventoryCtx;
      getOrCreateWallet(invCtx, identity);
      grantStartingKit(invCtx, identity);
    }
  }
);

/**
 * Sync fitness XP from the Aurisar profile into world level (P2).
 * fitnessXp must be monotonic; worldLevel is derived server-side.
 */
export const syncProgress = spacetimedb.reducer(
  {
    fitnessXp:         t.u64(),
    fitnessXpBaseline: t.u64(),
  },
  (ctx, { fitnessXp, fitnessXpBaseline }) => {
    const xp = Number(fitnessXp);
    const baseline = Number(fitnessXpBaseline);
    if (!Number.isFinite(xp) || xp < 0) return;
    if (!Number.isFinite(baseline) || baseline < 0) return;

    const level = worldLevelFromFitnessXp(xp, baseline);
    const existing = ctx.db.playerProgress.identity.find(ctx.sender);
    if (existing) {
      if (fitnessXp < existing.fitnessXp) return;
      ctx.db.playerProgress.identity.update({
        ...existing,
        fitnessXp,
        fitnessXpBaseline,
        worldLevel: level,
      });
    } else {
      ctx.db.playerProgress.insert({
        identity: ctx.sender,
        fitnessXp,
        fitnessXpBaseline,
        worldLevel: level,
      });
    }
  }
);

/**
 * P4 — consume a food/consumable item for server-authoritative healing.
 */
export const consumeItem = spacetimedb.reducer(
  { itemId: t.string() },
  (ctx, { itemId }) => {
    const identity = ctx.sender;
    const player = ctx.db.player.identity.find(identity);
    if (!player) return;
    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > nowMicros) return;

    const def = getItemDef(itemId);
    if (!isConsumable(def)) return;

    const invCtx = ctx as InventoryCtx;
    if (!removeItemStack(invCtx, identity, itemId, 1)) return;
    applyHeal(invCtx, identity, def!.heal ?? 0);
  }
);

/**
 * P4 — one-time migration from client localStorage inventory. Converts
 * legacy `coin` stacks to copper; skips unknown item ids.
 */
export const importInventory = spacetimedb.reducer(
  {
    itemsJson: t.string(),
    coinQty:   t.u32(),
  },
  (ctx, { itemsJson, coinQty }) => {
    const identity = ctx.sender;
    const invCtx = ctx as InventoryCtx;
    const wallet = getOrCreateWallet(invCtx, identity);
    if (wallet.imported) return;

    let copperFromCoins = 0;
    try {
      const parsed = JSON.parse(itemsJson) as Record<string, number>;
      if (parsed && typeof parsed === 'object') {
        for (const [itemId, rawQty] of Object.entries(parsed)) {
          const qty = Math.floor(Number(rawQty));
          if (!Number.isFinite(qty) || qty <= 0) continue;
          if (itemId === 'coin') {
            copperFromCoins += qty;
            continue;
          }
          if (!ITEMS[itemId]) continue;
          addItemStack(invCtx, identity, itemId, qty);
        }
      }
    } catch {
      // malformed JSON — still mark imported so we don't retry forever
    }

    const totalCopper = copperFromCoins + Math.max(0, Math.floor(coinQty));
    ctx.db.playerWallet.identity.update({
      ...wallet,
      imported: true,
      copper: wallet.copper + BigInt(totalCopper),
    });
    refreshCollectQuestProgress(invCtx, identity);
  }
);

/**
 * P4 phase 3 — buy an item from a vendor NPC's wares while in range.
 */
export const buyFromVendor = spacetimedb.reducer(
  {
    npcId:    t.string(),
    itemId:   t.string(),
    quantity: t.u32(),
  },
  (ctx, { npcId, itemId, quantity }) => {
    const identity = ctx.sender;
    const player = ctx.db.player.identity.find(identity);
    if (!player) return;
    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > nowMicros) return;
    if (!isVendorNpc(npcId) || !vendorSellsItem(npcId, itemId)) return;
    if (!playerNearNpc(player, npcId)) return;

    const def = getItemDef(itemId);
    if (!def) return;
    const unitPrice = buyPriceCopper(itemId);
    if (unitPrice <= 0) return;
    if (def.minLevel && getPlayerLevel(ctx, identity) < def.minLevel) return;

    const qty = clampTradeQty(quantity, def.stack);
    if (qty <= 0) return;
    const totalCost = unitPrice * qty;

    const invCtx = ctx as InventoryCtx;
    if (!deductCopper(invCtx, identity, totalCost)) return;
    const granted = addItemStack(invCtx, identity, itemId, qty);
    if (granted < qty) {
      addCopper(invCtx, identity, unitPrice * (qty - granted));
    }
    if (granted <= 0) return;
    refreshCollectQuestProgress(invCtx, identity);
  }
);

/**
 * P4 phase 3 — sell items from inventory to a vendor NPC while in range.
 */
export const sellToVendor = spacetimedb.reducer(
  {
    npcId:    t.string(),
    itemId:   t.string(),
    quantity: t.u32(),
  },
  (ctx, { npcId, itemId, quantity }) => {
    const identity = ctx.sender;
    const player = ctx.db.player.identity.find(identity);
    if (!player) return;
    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > nowMicros) return;
    if (!isVendorNpc(npcId)) return;
    if (!playerNearNpc(player, npcId)) return;

    const def = getItemDef(itemId);
    if (!def) return;
    const unitPrice = itemSellPrice(itemId);
    if (unitPrice <= 0) return;

    const invCtx = ctx as InventoryCtx;
    const owned = countItemOwned(invCtx, identity, itemId);
    const qty = clampTradeQty(Math.min(quantity, owned), def.stack);
    if (qty <= 0) return;

    if (!removeItemStack(invCtx, identity, itemId, qty)) return;
    addCopper(invCtx, identity, unitPrice * qty);
    refreshCollectQuestProgress(invCtx, identity);
  }
);

/**
 * Update the calling player's full avatar customization config.
 * Called after the user saves changes in AvatarCreator.
 */
export const setAvatarConfig = spacetimedb.reducer(
  { avatarConfig: t.string() },
  (ctx, { avatarConfig }) => {
    if (avatarConfig.length > 4096) throw new Error('avatarConfig too large');
    const existing = ctx.db.player.identity.find(ctx.sender);
    if (!existing) return;
    ctx.db.player.identity.update({ ...existing, avatarConfig });
  }
);

/**
 * Called on every movement tick from the client (~20 times/sec while moving).
 * The server clamps the claimed position twice before storing it: to the world
 * bounds, then to what max speed allows since the last accepted move
 * (world/moveGuard.ts). Position is still client-authoritative — the guard
 * bounds how fast it can lie, not whether it can.
 *
 * Slice 5c: dead players cannot move. Their `playerRespawnQueue` row will
 * teleport them to origin when the timer fires.
 */
/**
 * Every `playerAura` row belonging to `owner`, taken as ONE pass (M9-6).
 *
 * `playerAura` has no index by owner, so each consumer that "just needs the
 * stuns" or "just needs the shields" would otherwise cost its own full scan.
 * The three consumers — `movePlayer`'s control check, `castAbilityById`'s buff
 * fold and `applyMobHit`'s absorb drain — each take this snapshot once and
 * read whatever they need out of it.
 *
 * Expired rows are NOT filtered here: `tickAuras` sweeps them at 1 Hz and each
 * helper in `combat/auras.ts` re-checks `expiresAt` against the caller's own
 * `nowMicros`, which is stricter than anything a stale sweep could give.
 */
function playerAuraRows(ctx: any, owner: any): any[] {
  const out: any[] = [];
  for (const row of ctx.db.playerAura.iter()) {
    if (row.owner.isEqual(owner)) out.push(row);
  }
  return out;
}

export const movePlayer = spacetimedb.reducer(
  {
    x:         t.f32(),
    y:         t.f32(),
    direction: t.u8(),
    isMoving:  t.bool(),
    floorYM:   t.f32(),
  },
  (ctx, { x, y, direction, isMoving, floorYM }) => {
    const identity = ctx.sender;
    const existing = ctx.db.player.identity.find(identity);
    if (!existing) return; // player hasn't called setPlayerInfo yet

    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;

    // Reject moves while dead — server pins the corpse until respawnPlayer fires.
    if (existing.hp <= 0 || existing.deadUntil > nowMicros) {
      return;
    }

    // Server-side move-rate floor. The client paces itself (~12 Hz), but this
    // reducer had no throttle at all — the one hot path without one (chat and
    // attack both have cooldowns), so a modified client could rewrite its row
    // at frame rate and fan every write out to every subscriber. 40 ms (25 Hz)
    // sits above any legitimate client rate, so honest traffic never drops.
    if (existing.lastMoveAt > 0n && nowMicros - existing.lastMoveAt < MOVE_MIN_INTERVAL_MICROS) {
      return;
    }

    // ── Control auras (M9-6) ────────────────────────────────────────────────
    // The FIRST real caller of `slowMultiplier` (combat/auras.ts): `magnitude`
    // on a slow row is a PERCENT in 0..90, not a fraction, and that helper is
    // the only place the conversion happens.
    //
    // Placed after the 40 ms rate floor so the `playerAura` scan is paid at
    // most 25 Hz per player, and before the speed clamp because the clamp is
    // what the multiplier scales.
    //
    // stun/root REJECT rather than clamp, which is the one deliberate
    // exception to moveGuard.ts's "clamp, never reject" rule: a stun that let
    // the row creep forward at 10 % speed would not be a stun. The desync it
    // causes is bounded — the client can see the aura row and stops locally,
    // and the first move after the aura lapses is measured from the stored
    // position with MOVE_MAX_CREDIT_MICROS of budget, so the row re-converges
    // within a few calls instead of being stranded.
    const control = movementRestriction(playerAuraRows(ctx, identity), nowMicros);
    if (control.blocked) return;

    // Per-zone world bounds (D156). resolveZone answers "which zone owns this
    // px pair, and is it inside that zone's box" in one pass and hands back
    // the claim clamped into it. Clamp, not reject: that is what the single
    // global box did for zone 1 and what moveGuard.ts's own doc comment
    // explains — a rejected move strands the stored row while the client keeps
    // walking. An out-of-bounds claim is pulled to the nearest edge of the
    // nearest zone, so no position the retired clamp accepted is refused here.
    const bounded = resolveZone(x, y);
    const boundedX = bounded.x;
    const boundedY = bounded.y;

    // Speed ceiling on the claimed position. Bounds-clamping alone let a
    // modified client rewrite this row to anywhere in the disc between calls,
    // and every proximity gate in this module (chests, vendors, dungeon entry,
    // melee, cooking) trusts it — see world/moveGuard.ts. Applied above the
    // castle branch so nav validation runs against the position we will
    // actually store.
    //
    // A zero lastMoveAt means "no baseline", not "unguarded": it is spent as
    // zero elapsed (the jitter grace and nothing more) rather than skipping
    // the clamp, so the first move on a row cannot be a free teleport. Every
    // spawn, connect and teleport path seeds lastMoveAt, so in practice this
    // fallback only covers a row written before those paths existed.
    const elapsedMicros = existing.lastMoveAt > 0n ? nowMicros - existing.lastMoveAt : 0n;
    const guarded = clampMoveToMaxSpeed(
      existing.x, existing.y, boundedX, boundedY, elapsedMicros,
      control.speedMultiplier,
    );
    let clampedX = guarded.x;
    let clampedY = guarded.y;

    // Cheap no-op check BEFORE the interior-nav branch: identical inputs
    // against an already-validated row resolve to the identical row, so bail
    // before paying the px→m conversion and grid scan for a resend. (The full
    // post-computation dead-band below still catches zoneId/floor no-ops.)
    if (
      existing.x === clampedX && existing.y === clampedY &&
      existing.direction === direction % 4 && existing.isMoving === isMoving &&
      (existing.dungeonInstanceId === 0n || existing.floorYM === floorYM)
    ) {
      return;
    }

    let nextFloorYM = existing.floorYM;

    // The nav grids of whichever dungeon this instance ACTUALLY belongs to —
    // resolved from the instance row, never assumed from a nonzero
    // dungeonInstanceId and never from a dungeon id literal.
    //
    // This branch used to run against Castle Ashwood's grids for every
    // instance (D174 item 3). M11-1 narrowed it to "the dungeon that claims
    // Ashwood's bitmaps", which at the time meant Ashwood alone, so the
    // Barrowdeep — a real, shipped dungeon whose own bitmaps were already
    // committed — fell to the `else` below: no wall collision inside it at
    // all, and its players' floorYM zeroed on their first step while the
    // instance's mobs sat on 11.0 / 0.6. R21 routes the branch through the
    // per-dungeon descriptor instead, so each dungeon is checked against its
    // own walls and no dungeon is checked against another's.
    //
    // The lookup itself lives in dungeon/helpers.ts so it is unit-testable
    // against a fake instance table for a NON-Ashwood dungeon — this file
    // cannot be imported under vitest. See dungeonInteriorNav.test.ts, which
    // also pins structurally that this call is the one made here.
    const interiorNav: DungeonInteriorNav | null =
      interiorNavForInstance(ctx, existing.dungeonInstanceId);

    // Interior rules apply only inside an instance whose dungeon has
    // registered nav grids (D65 puts Ashwood's interior at world coordinates
    // 782..898 × -44..44, which the overworld also covers; an outdoor player
    // crossing that footprint must not be resolved against the castle grids).
    // A dungeon with no interior row still skips wall collision here rather
    // than being checked against the wrong dungeon's walls — but every shipped
    // DungeonDef has one, pinned by dungeonInteriorCoupling.test.ts.
    if (interiorNav) {
      const step = resolveInteriorStep(
        interiorNav,
        existing.x, existing.y, existing.floorYM,
        clampedX, clampedY, floorYM,
        guarded.clamped,
      );
      if (!step) return;
      clampedX = step.x;
      clampedY = step.y;
      nextFloorYM = step.floorYM;
    } else if (existing.floorYM !== 0) {
      nextFloorYM = 0;
    }

    // Zone id from the content manifest, resolved against the position we are
    // actually about to store — the speed guard and the castle-interior
    // resolution above can both move the point after the bounds pass.
    const zoneId = resolveZone(clampedX, clampedY).zoneId;

    // No-op dead-band: a row update is broadcast to EVERY subscriber, so a
    // call that changes nothing (client resend, isMoving heartbeat) must not
    // become N deltas. lastMoveAt alone never justifies a write.
    const dir = direction % 4;
    if (
      existing.x === clampedX && existing.y === clampedY &&
      existing.direction === dir && existing.isMoving === isMoving &&
      existing.zoneId === zoneId && existing.floorYM === nextFloorYM
    ) {
      return;
    }

    ctx.db.player.identity.update({
      ...existing,
      x: clampedX,
      y: clampedY,
      direction: dir,
      isMoving,
      zoneId,
      floorYM: nextFloorYM,
      lastMoveAt: nowMicros,
    });
  }
);

/**
 * Server-authoritative castle / dungeon entry. Validates gate proximity,
 * assigns or creates a ≤5-player instance, teleports to the interior spawn,
 * and seeds instance mobs on first creation.
 *
 * minLevel gating via playerProgress (syncProgress on connect).
 */
export const enterDungeon = spacetimedb.reducer(
  { dungeonId: t.string() },
  (ctx, { dungeonId }) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player) return;
    const now = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > now) return;
    if (player.dungeonInstanceId > 0n) return;

    const dungeon = DUNGEONS_BY_ID[dungeonId];
    if (!dungeon) return;

    if (getPlayerLevel(ctx, ctx.sender) < dungeon.minLevel) return;

    const gatePx = zoneEntranceToPx(dungeon);
    if (distSqPx(player.x, player.y, gatePx.x, gatePx.y) > DUNGEON_GATE_RANGE_PX * DUNGEON_GATE_RANGE_PX) {
      return;
    }

    let instanceId = findOpenDungeonInstance(ctx, dungeonId);
    let created = false;
    if (!instanceId) {
      const row = ctx.db.dungeonInstance.insert({
        instanceId: 0n,
        dungeonId,
        createdAt: now,
      });
      instanceId = row.instanceId;
      created = true;
    }

    // Per-DungeonDef lookup, not a literal compare against one dungeon's id
    // (D174 item 1) — dungeonSpawnPx resolves whichever dungeon is actually
    // being entered's own registered interior spawn point, falling back to
    // its gate (== gatePx above) when no interior entry is registered yet.
    const spawnPx = dungeonSpawnPx(dungeon);
    // The ENTERED dungeon's own entry-storey floor, not Castle Ashwood's.
    // This was `CASTLE_LEVELS[1].y` for every dungeon — correct today only by
    // coincidence, since D171 gave the Barrowdeep Ashwood's level Y verbatim
    // (the last surviving D174 item-1 literal). 0 when the dungeon registers
    // no interior: dungeonSpawnPx then fell back to its outdoor gate, so the
    // player is standing outside and 0 is what movePlayer's own else-branch
    // would write on their first step anyway. Unreachable for shipped content
    // — every DungeonDef has an interior row (dungeonInteriorCoupling.test.ts).
    const entryFloorYM = dungeonInteriorNavFor(dungeonId)?.entryFloorYM ?? 0;
    ctx.db.player.identity.update({
      ...player,
      x: spawnPx.x,
      y: spawnPx.y,
      isMoving: false,
      zoneId: resolveZone(spawnPx.x, spawnPx.y).zoneId,
      dungeonInstanceId: instanceId,
      floorYM: entryFloorYM,
      // Teleports bypass the speed guard by writing the row directly, but they
      // must still restart its clock: leaving a stale lastMoveAt here would
      // hand the first step inside the interior a budget earned outdoors.
      lastMoveAt: ctx.timestamp.microsSinceUnixEpoch,
    });

    if (created) seedDungeonInstanceMobs(ctx, instanceId, dungeonId);
  }
);

/**
 * Leave the active dungeon instance. Requires proximity to the interior
 * exit hotspot; teleports to the overworld gate and cleans up empty instances.
 */
export const leaveDungeon = spacetimedb.reducer(
  {},
  (ctx) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player || player.dungeonInstanceId === 0n) return;

    const instance = ctx.db.dungeonInstance.instanceId.find(player.dungeonInstanceId);
    if (!instance) {
      ctx.db.player.identity.update({ ...player, dungeonInstanceId: 0n });
      return;
    }

    // Resolved BEFORE the exit-proximity check (D174 item 2) — the old code
    // called the Ashwood-only castleExitHotspotPx() unconditionally here, so
    // leaving any OTHER dungeon checked proximity against Ashwood's hotspot
    // in zone 1 before ever looking up which dungeon the instance actually
    // was.
    const dungeon = DUNGEONS_BY_ID[instance.dungeonId];
    const exitPx = dungeon ? dungeonExitHotspotPx(dungeon) : { x: WORLD_ORIGIN_PX, y: WORLD_ORIGIN_PX };
    if (distSqPx(player.x, player.y, exitPx.x, exitPx.y) > DUNGEON_EXIT_RANGE_PX * DUNGEON_EXIT_RANGE_PX) {
      return;
    }

    const gatePx = dungeon ? zoneEntranceToPx(dungeon) : { x: WORLD_ORIGIN_PX, y: WORLD_ORIGIN_PX };
    const leavingInstance = player.dungeonInstanceId;

    ctx.db.player.identity.update({
      ...player,
      x: gatePx.x,
      y: gatePx.y,
      isMoving: false,
      zoneId: resolveZone(gatePx.x, gatePx.y).zoneId,
      dungeonInstanceId: 0n,
      floorYM: 0,
      lastMoveAt: ctx.timestamp.microsSinceUnixEpoch,
    });

    cleanupDungeonInstanceIfEmpty(ctx, leavingInstance);
  }
);

/**
 * Gate-based zone-to-zone travel (D155). Zone 2+ are offset regions on the
 * shared px plane, not a contiguous terrain extension and not a dungeon
 * instance — this reducer is the transition D155 calls for, modeled directly
 * on enterDungeon/leaveDungeon above as the working mechanism to follow.
 *
 * Guard order mirrors enterDungeon's own chain:
 *   • player exists and is alive — dead (hp/deadUntil) and stunned/rooted
 *     (movementRestriction), the same guards movePlayer applies;
 *   • the named gate resolves in the CURRENT zone (player.zoneId, D157), the
 *     caller is within range of it, the destination zone/gate both actually
 *     exist in the manifest (defensive — content validation should already
 *     guarantee this, but a reducer must not trust content shape blindly at
 *     runtime either), and the caller's level clears the destination zone's
 *     levelBand floor — see world/travel.ts's resolveGateTravel for that
 *     chain, kept there (not inlined) so it is unit-testable without a
 *     spacetimedb/server runtime.
 *
 * Takes only the gate id the player claims to be standing at; the
 * destination is derived from the gate's own toZoneId/toGateId. The
 * proximity check reads the player's own stored x/y, never a client-supplied
 * coordinate, so — unlike buildCampfire (PR #363 review, finding M1) — there
 * is no spoofable claim here for a non-finite value to bypass.
 *
 * Inert today: zone 1's only gate (z1_north_pass) names toZoneId: 2, which
 * has no manifest entry yet, so every call resolves to resolveGateTravel's
 * 'bad-destination' rejection until a second zone ships (M10-2+).
 */
export const travelToZone = spacetimedb.reducer(
  { gateId: t.string() },
  (ctx, { gateId }) => {
    const identity = ctx.sender;
    const player = ctx.db.player.identity.find(identity);
    if (!player) return;

    const now = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > now) return;
    if (movementRestriction(playerAuraRows(ctx, identity), now).blocked) return;

    const outcome = resolveGateTravel(player, player.zoneId, gateId, getPlayerLevel(ctx, identity));
    if (!outcome.ok) return;

    ctx.db.player.identity.update({
      ...player,
      x: outcome.x,
      y: outcome.y,
      isMoving: false,
      // Re-derived from the position we are actually about to store, same as
      // movePlayer/enterDungeon/leaveDungeon: the zoneId written must come
      // from resolveZone, not trusted straight off the content's own
      // toZoneId, in case a gate's declared position doesn't actually fall
      // inside its destination zone's playable box.
      zoneId: resolveZone(outcome.x, outcome.y).zoneId,
      floorYM: 0,
      // Teleports bypass the speed guard by writing the row directly, but
      // must still restart its clock — see enterDungeon/leaveDungeon.
      lastMoveAt: now,
    });
  }
);

/**
 * Send a chat message (world or proximity).
 * Rate limited: max 1 message per second per sender (enforced server-side
 * via player.lastChatAt — a malicious client cannot spam past this).
 */
const CHAT_COOLDOWN_MICROS = 1_000_000n; // 1 second

// movePlayer accepts at most one write per 40 ms (25 Hz) per player — above
// every legitimate client rate, below a frame-rate hammer. See movePlayer.
const MOVE_MIN_INTERVAL_MICROS = 40_000n;

// chat_message was insert-only with no cap, TTL, or delete anywhere: every
// client downloaded the module's entire chat history on connect — the single
// worst row-count offender at scale. Keep a rolling window; 200 lines is far
// more scrollback than the chat panel shows.
const CHAT_MAX_ROWS = 200;

export const sendChat = spacetimedb.reducer(
  {
    text:    t.string(),
    msgType: t.string(),
  },
  (ctx, { text, msgType }) => {
    const identity = ctx.sender;
    const player = ctx.db.player.identity.find(identity);
    if (!player) return;

    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (player.lastChatAt > 0n && nowMicros - player.lastChatAt < CHAT_COOLDOWN_MICROS) {
      return; // dropped: sender is over the 1 msg/sec rate limit
    }

    const safeText = text.trim().slice(0, 280);
    if (!safeText) return;

    const safeMsgType = ['world', 'proximity', 'emote'].includes(msgType)
      ? msgType
      : 'world';

    ctx.db.chatMessage.insert({
      id: nowMicros,
      senderId: identity,
      senderName: player.username,
      text: safeText,
      sentAt: nowMicros / 1000n, // ms
      msgType: safeMsgType,
      x: player.x,
      y: player.y,
    });

    // Rolling window: drop everything beyond the newest CHAT_MAX_ROWS. The
    // per-send cost is O(rows) over a table this same code keeps at ≤200 —
    // except the very first send after this deploys, which drains the entire
    // pre-cap backlog once. `id` is the send timestamp, so ordering by it is
    // ordering by age; delete-by-row needs no key or schema change.
    const rows = [...ctx.db.chatMessage.iter()];
    if (rows.length > CHAT_MAX_ROWS) {
      rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      // Bounded per call: delete-by-value is O(table) each, so an unbounded
      // drain of a large pre-cap backlog could blow the reducer budget and
      // abort the transaction INCLUDING the insert — chat would fail closed
      // and retry the same doomed work forever. 50/call converges to the same
      // steady state with no cliff.
      for (const old of rows.slice(0, Math.min(rows.length - CHAT_MAX_ROWS, 50))) {
        ctx.db.chatMessage.delete(old);
      }
    }

    ctx.db.player.identity.update({ ...player, lastChatAt: nowMicros });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// CAMPFIRES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a campfire at (x, y) STDB px. The client places it ~2.2 m in front
 * of the avatar; the server only trusts that it's within arm's reach.
 *
 * Guards:
 *   • dead players can't build
 *   • placement must be within CAMPFIRE_PLACE_RANGE_PX of the builder
 *   • per-player cooldown, anchored on the player's newest fire's litAt
 *     (no player-table column needed: a fire always outlives the cooldown
 *     window since CAMPFIRE_BURN >> CAMPFIRE_COOLDOWN)
 *   • per-player cap — building past it snuffs the oldest fire (its queued
 *     expiry then no-ops on the missing row)
 *   • costs CAMPFIRE_WOOD_COST firewood from server inventory (P4 phase 4)
 */
export const buildCampfire = spacetimedb.reducer(
  {
    x: t.f32(),
    y: t.f32(),
  },
  (ctx, { x, y }) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player) return;

    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > nowMicros) return; // dead can't build

    // Must be placed within reach of where the server thinks the player is.
    // Inverted (`!(... <= R*R)`, not `... > R*R`) so a non-finite x/y — the BSATN f32 decode is a
    // bare DataView.getFloat32 with no validation, so a malformed client packet can send NaN —
    // fails closed. `NaN > anything` is false, so the un-inverted guard let NaN through to
    // resolveZone(NaN, NaN), which places a working, lit campfire at the first zone's centre on
    // behalf of a player standing anywhere on the map (PR #363 review, finding M1).
    const dx = x - player.x;
    const dy = y - player.y;
    if (!(dx * dx + dy * dy <= CAMPFIRE_PLACE_RANGE_PX * CAMPFIRE_PLACE_RANGE_PX)) return;

    // Same per-zone bounds the move path uses. The fire is placed within 3 m
    // of the builder, so this only ever trims a claim the builder's own row
    // could not have reached.
    const placed = resolveZone(x, y);
    const fx = placed.x;
    const fy = placed.y;

    // Scan the caller's fires once for both the cooldown and the cap.
    let count = 0;
    let newestLitAt = 0n;
    let oldest: { campfireId: bigint; litAt: bigint } | null = null;
    for (const f of ctx.db.campfire.iter()) {
      if (!f.ownerId.isEqual(player.identity)) continue;
      count++;
      if (f.litAt > newestLitAt) newestLitAt = f.litAt;
      if (oldest === null || f.litAt < oldest.litAt) {
        oldest = { campfireId: f.campfireId, litAt: f.litAt };
      }
    }
    if (newestLitAt > 0n && nowMicros - newestLitAt < CAMPFIRE_COOLDOWN_MICROS) {
      return; // dropped: over the build cadence
    }

    const invCtx = ctx as InventoryCtx;
    if (countItemOwned(invCtx, player.identity, 'wood') < CAMPFIRE_WOOD_COST) return;
    if (!removeItemStack(invCtx, player.identity, 'wood', CAMPFIRE_WOOD_COST)) return;

    if (count >= CAMPFIRE_MAX_PER_PLAYER && oldest) {
      ctx.db.campfire.campfireId.delete(oldest.campfireId);
    }

    const expiresAt = nowMicros + CAMPFIRE_BURN_MICROS;
    const campfireId = nowMicros;
    ctx.db.campfire.insert({
      campfireId,
      ownerId: player.identity,
      ownerName: player.username,
      x: fx,
      y: fy,
      litAt: nowMicros,
      expiresAt,
    });
    ctx.db.campfireExpireQueue.insert({
      id: 0n,    // auto-inc replaces this
      scheduledAt: ScheduleAt.time(expiresAt),
      campfireId,
    });
  }
);

/**
 * P4 phase 4 — loot a world chest once. Seed and position come from the
 * baked world chest manifest; the client only supplies chestId.
 */
export const openChest = spacetimedb.reducer(
  { chestId: t.u32() },
  (ctx, { chestId }) => {
    const identity = ctx.sender;
    const player = ctx.db.player.identity.find(identity);
    if (!player) return;
    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > nowMicros) return;

    const invCtx = ctx as InventoryCtx;
    if (!openChestForPlayer(invCtx, identity, player, chestId)) return;
    refreshCollectQuestProgress(invCtx, identity);
  }
);

/**
 * P4 phase 4 — cook a recipe near a lit campfire. Consumes inputs server-side.
 */
export const cookRecipe = spacetimedb.reducer(
  { recipeId: t.string() },
  (ctx, { recipeId }) => {
    const identity = ctx.sender;
    const player = ctx.db.player.identity.find(identity);
    if (!player) return;
    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > nowMicros) return;

    const invCtx = ctx as InventoryCtx;
    if (!playerNearLitCampfire(invCtx, player)) return;
    if (!cookRecipeForPlayer(invCtx, identity, recipeId)) return;
    refreshCollectQuestProgress(invCtx, identity);
  }
);

/**
 * P4 phase 5 — equip a weapon or armor piece from the player's bag.
 */
export const equipItem = spacetimedb.reducer(
  { itemId: t.string() },
  (ctx, { itemId }) => {
    const identity = ctx.sender;
    const player = ctx.db.player.identity.find(identity);
    if (!player) return;
    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > nowMicros) return;

    const invCtx = ctx as InventoryCtx;
    equipItemForPlayer(invCtx, identity, itemId, getPlayerLevel(ctx, identity));
  }
);

/**
 * P4 phase 5 — unequip a slot and return the item to the bag.
 */
export const unequipItem = spacetimedb.reducer(
  { slot: t.string() },
  (ctx, { slot }) => {
    const identity = ctx.sender;
    const player = ctx.db.player.identity.find(identity);
    if (!player) return;
    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > nowMicros) return;

    unequipSlotForPlayer(ctx as InventoryCtx, identity, slot);
  }
);

/**
 * Scheduled campfire burnout. Fires once at expiresAt; deleting an
 * already-snuffed fire (cap eviction) is a silent no-op.
 */
export const expireCampfire = spacetimedb.reducer(
  {
    schedule: campfireExpireQueueRow,
  },
  (ctx, { schedule }) => {
    const fire = ctx.db.campfire.campfireId.find(schedule.campfireId);
    if (!fire) return;
    ctx.db.campfire.campfireId.delete(schedule.campfireId);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// COMBAT (slice 5a / 5c)
// ─────────────────────────────────────────────────────────────────────────────

const MELEE_RANGE_PX        = 96;             // 3 world units = 96 STDB px
const MELEE_DAMAGE          = 25;             // 4 swings kills a 100-HP wolf
const MELEE_COOLDOWN_MICROS = 300_000n;       // 300 ms between swings; client throttles at 350 ms so legit input has headroom

/**
 * Idempotently seed mobs from the bundled per-tile gameplay manifest, and
 * self-heal any stale rows left over from older module versions.
 *
 * Called by the client on connect; safe to call repeatedly. Three passes:
 *
 *   1. Bootstrap the AI tick scheduler if it doesn't exist yet. The live
 *      maincloud module was published before `init` lifecycles, so we
 *      lazy-init here.
 *
 *   2. Self-heal pass over existing mob rows. After the slice 5c schema
 *      migration, rows that existed pre-migration have spawn_x/spawn_y/
 *      aggro/leash/respawn_sec backfilled to ADD COLUMN defaults — the
 *      AI tick would treat that as "leash anchor is world origin," which
 *      is wrong for any wolf not actually spawned there. We fix in code:
 *        • If a row's spawn_net_id isn't in the current manifest (e.g.
 *          slice-5a's `SLICE5A_HARDCODED_WOLF`), delete it. It belongs
 *          to a retired spawn definition.
 *        • If a row's spawn_net_id IS in the manifest but its spawnX/Y
 *          are zero (the ADD COLUMN default sentinel), update it in
 *          place with the manifest's real coords and radii.
 *      This pass keeps `seedWorld` the single source of truth for the
 *      mob table's shape and avoids needing manual `DELETE FROM mob`
 *      after schema-changing publishes.
 *
 *   3. Insert any manifest spawn points that aren't represented yet.
 *      Net IDs are suffixed by instance index (e.g.
 *      `SPAWN_MOB_WOLF_NEAR_NW_0`, `_1`) so each row stays unique.
 */
export const seedWorld = spacetimedb.reducer({}, (ctx) => {
  // 1. Bootstrap the AI tick scheduler if missing.
  if (ctx.db.mobAiTickSchedule.count() === 0n) {
    ctx.db.mobAiTickSchedule.insert({
      id: 0n,    // auto-inc replaces this
      scheduledAt: ScheduleAt.interval(AI_TICK_MICROS),
    });
  }
  // M6: same lazy-init for the combat schedules. Doing it here rather than in
  // an `init` lifecycle is deliberate — the live maincloud module predates
  // `init`, so an ADD COLUMN publish never re-runs one.
  if (ctx.db.auraTickSchedule.count() === 0n) {
    ctx.db.auraTickSchedule.insert({
      id: 0n,
      scheduledAt: ScheduleAt.interval(AURA_TICK_MICROS),
    });
  }
  if (ctx.db.combatEventReapSchedule.count() === 0n) {
    ctx.db.combatEventReapSchedule.insert({
      id: 0n,
      scheduledAt: ScheduleAt.interval(COMBAT_EVENT_REAP_MICROS),
    });
  }

  // 2. Self-heal pass — drop rows whose spawn definition no longer exists.
  //    This is also the migration path away from the retired tile-JSON
  //    spawns: their netIds aren't in the content-built spawnByNetId map,
  //    so their live rows get deleted here and content spawns take over.
  const seeded = new Set<string>();
  const toDelete: bigint[] = [];
  for (const m of ctx.db.mob.iter()) {
    if (m.dungeonInstanceId > 0n) continue;
    const entry = spawnByNetId.get(m.spawnNetId);
    if (!entry) {
      toDelete.push(m.mobId);
      continue;
    }
    seeded.add(m.spawnNetId);
  }
  for (const mobId of toDelete) {
    // NON-KILL MOB DELETE: retiring a row whose spawn definition is gone. No
    // respawn is scheduled and nobody is credited. See combat/kill.ts.
    ctx.db.mob.mobId.delete(mobId);
  }

  // 3. Insert any content spawn instances not already represented.
  let inserted = 0;
  for (const [netId, entry] of spawnByNetId) {
    if (seeded.has(netId)) continue;
    insertMobFromSpawn(ctx, entry, netId, inserted);
    seeded.add(netId);
    inserted++;
  }
});

/**
 * Server-authoritative melee attack. Client passes a target mob_id; the
 * server validates the caller is within range and the mob is alive before
 * applying damage.
 *
 * Slice 5c: on kill, the mob row is deleted and a respawnQueue entry is
 * inserted scheduled `respawnSec` seconds out. The client sees the mob
 * disappear via onDelete; the respawn reducer inserts a fresh row that
 * triggers onInsert (clean spawn animation path).
 *
 * Dead players cannot attack (preserves "you died" lockout).
 */
export const castAbility = spacetimedb.reducer(
  {
    mobId: t.u64(),
  },
  (ctx, { mobId }) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player) return; // not authenticated yet

    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;

    // Dead players can't swing.
    if (player.hp <= 0 || player.deadUntil > nowMicros) return;

    // Server-enforced cooldown. The client throttles at 350ms for UX, but
    // a modified client could spam reducer calls without this guard — that
    // would let them instakill mobs while still passing the range check.
    // We also record the swing on accepted-but-missed calls (out of range,
    // dead mob) to neutralise DoS via spammed-miss probing.
    if (player.lastAttackAt > 0n && nowMicros - player.lastAttackAt < MELEE_COOLDOWN_MICROS) {
      return; // dropped: caller is over the melee cadence
    }
    ctx.db.player.identity.update({ ...player, lastAttackAt: nowMicros });

    const mob = ctx.db.mob.mobId.find(mobId);
    if (!mob) return;
    if (mob.hp <= 0) return;

    // Range check — squared euclidean to avoid sqrt; monotonic so the
    // comparison is equivalent to comparing actual distances.
    const dx = player.x - mob.x;
    const dy = player.y - mob.y;
    if (dx * dx + dy * dy > MELEE_RANGE_PX * MELEE_RANGE_PX) return;

    // Instance + floor gating for dungeon mobs.
    if (mob.dungeonInstanceId !== player.dungeonInstanceId) return;
    if (mob.dungeonInstanceId > 0n && !sameInteriorFloor(mob.floorYM, player.floorYM)) return;

    const newHp = mob.hp - MELEE_DAMAGE;
    // M6 §2.6: the melee fallback publishes events too, so the client has one
    // source of combat feedback regardless of which reducer swung.
    emitCombatEvent(ctx, {
      at: nowMicros,
      actor: player.identity,
      abilityId: '',
      targetMobId: mobId,
      kind: 'hit',
      amount: MELEE_DAMAGE,
    });
    if (newHp <= 0) {
      // Kill: the shared path (D89) deletes the row (client sees onDelete →
      // mob disappears), schedules the respawn, and credits quests + loot.
      // castAbility's own behaviour is unchanged — only this block moved.
      applyMobKill(
        ctx,
        player.identity,
        mob,
        nowMicros,
        (at) => ScheduleAt.time(at),
        creditKillToQuests,
        '',
      );
    } else {
      ctx.db.mob.mobId.update({ ...mob, hp: newHp });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// ABILITIES (M6)
// ─────────────────────────────────────────────────────────────────────────────

/** `reapCombatEvents` cadence. Rows live COMBAT_EVENT_TTL_MICROS (5 s). */
const COMBAT_EVENT_REAP_MICROS = 5_000_000n;

/**
 * Server-enforced floor between `castAbilityById` calls, in the same spirit
 * (and at the same cadence) as `MELEE_COOLDOWN_MICROS` guards `castAbility`.
 *
 * The GCD alone is not a throttle, because it is only set on SUCCESS: without
 * this, a modified client could loop `castAbilityById('nope', 0)` at frame
 * rate and every rejection would insert a row into `combatEvent`, which is
 * PUBLIC and therefore broadcast to every subscribed client. The reaper only
 * trims rows older than 5 s, so the steady-state table size would scale with
 * the spam rate — risk R8 re-entering through the rejection channel.
 *
 * The floor is carried by `lastAttackAt`, the column `castAbility` already
 * uses as a 300 ms rate limit — it is a pure rate limiter with no gameplay
 * meaning, so a rejected cast can stamp it freely.
 *
 * It is deliberately NOT carried by `lastGcdAt`. `lastGcdAt` is PUBLIC and
 * means “micros when the global cooldown frees”; stamping it on a mis-click
 * would render an ordinary out-of-range error as a real global cooldown on
 * every client. Worse, gating on it before the ability is looked up would
 * silently swallow off-GCD abilities — `titan_immovable` (`classes/titan.ts`,
 * `triggersGcd: false`) is a panic-button defensive that exists precisely to
 * be pressed WHILE the GCD is running. The GCD stays where the resolver puts
 * it: `validateCast`, per-ability, after the lookup.
 *
 * A call arriving inside the floor is dropped BEFORE any work and writes
 * nothing at all, so at most ONE rejection event per caster per window ever
 * reaches the table.
 */
const CAST_THROTTLE_MICROS = 300_000n;

/**
 * M6 §2.3 — the ability reducer.
 *
 * `castAbility` above stays as the fixed melee fallback the web client ships
 * today (D16); this is the content-driven path. All the maths lives in the
 * canonical resolver (`content/formulas/abilityResolve.ts`, mirrored from
 * `src/features/world/content/`), so this reducer only does what a pure
 * function cannot: read rows, roll a seeded RNG, and write the deltas back.
 *
 * `targetMobId = 0n` means "no target" — correct for self-cast abilities,
 * which content marks with `rangeM === 0`.
 *
 * Every rejection publishes a `combatEvent` with its reason (§2.6) instead of
 * the bare `return` that leaves the caller guessing.
 */
export const castAbilityById = spacetimedb.reducer(
  {
    abilityId:   t.string(),
    targetMobId: t.u64(),
  },
  (ctx, { abilityId, targetMobId }) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player) return; // not authenticated yet — no row to attribute an event to

    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;

    // ── Throttle, BEFORE any work (see CAST_THROTTLE_MICROS) ──────────────
    // Rate limit only — NOT the global cooldown, which is per-ability and is
    // enforced by `validateCast` after the lookup. Anything arriving inside
    // the floor is dropped silently: no table scan, no resolver call, and
    // above all no combatEvent row. That is what caps rejection events at one
    // per caster per window. Shared with `castAbility`'s melee cadence, which
    // is correct: one player, one hand, one action rate.
    if (
      player.lastAttackAt > 0n &&
      nowMicros - player.lastAttackAt < CAST_THROTTLE_MICROS
    ) return;

    const reject = (reason: string): void => {
      emitCombatEvent(ctx, {
        at: nowMicros,
        actor: player.identity,
        abilityId,
        targetMobId,
        kind: 'rejected',
        reason,
      });
      // A rejected cast still costs the caller time, so a rejection loop
      // cannot drive inserts into a public table at frame rate. Every reject()
      // call site returns immediately after and writes no other player field,
      // so spreading the row we read is safe. `lastGcdAt` is deliberately NOT
      // touched: a mis-click must not render as a global cooldown.
      ctx.db.player.identity.update({
        ...player,
        lastAttackAt: nowMicros,
      });
    };

    // Dead players cannot cast — mirrors castAbility's gate.
    if (player.hp <= 0 || player.deadUntil > nowMicros) {
      reject('casterDead');
      return;
    }

    const level = getPlayerLevel(ctx, player.identity);
    // ONE `playerEquipped` pass for the whole cast: attributes, weapon band and
    // the resource pool all read from it (review L-1). The table has no owner
    // index, so each extra helper call was a full table scan.
    const snapshot = equippedSnapshot(ctx, player.identity);
    // ── Buff consumption (M9-6) ───────────────────────────────────────────
    // Live `selfBuff` / `buffTarget` auras are folded into the attribute block
    // the resolver will derive from, so `content/formulas/combat.ts` stays a
    // pure function of attributes (D121 — the root vitest suite depends on
    // that) and `deriveStats` needs no aura parameter.
    //
    // `buffedAttributes` documents why the fold is exact and why an `armor`
    // buff is NOT folded (CON drives maxHp as well as armor).
    //
    // These attributes feed `resourceMax` too, deliberately: an INT/WIS buff
    // that raised the pool for the damage roll but not for the cost check
    // would be two different casters in one reducer.
    const auraBuffs = auraStatBonuses(playerAuraRows(ctx, player.identity), nowMicros);
    const buffedAttrs = buffedAttributes(snapshot.attrs, auraBuffs);
    const buffedSnapshot = { ...snapshot, attrs: buffedAttrs };
    const resourceMax = maxResourceFrom(buffedAttrs, player.classType, level);
    // D94: regeneration is settled HERE, lazily, from `lastRegenAt` — not by a
    // 1 Hz sweep. The caster validates and spends against the regenerated
    // value, and the row below stores it.
    const resourceNow = regeneratedResource(
      player.resource, resourceMax, player.lastRegenAt, nowMicros,
    );
    const caster = buildCasterState(ctx, player, level, buffedSnapshot, resourceNow);
    if (!caster) {
      // classType is a free string column; a row carrying a retired class id
      // has no kit, so no ability can belong to it.
      reject('wrongClass');
      return;
    }

    const def = abilityById(abilityId);

    // Target resolution. A mob in another dungeon instance, or on another
    // interior floor, is not reachable — verbatim castAbility's gates — so it
    // is presented to the validator as no target at all rather than as an
    // out-of-range one, which would tell the client to walk closer.
    let mob = targetMobId > 0n ? ctx.db.mob.mobId.find(targetMobId) : null;
    if (mob) {
      if (mob.dungeonInstanceId !== player.dungeonInstanceId) mob = null;
      else if (
        mob.dungeonInstanceId > 0n &&
        !sameInteriorFloor(mob.floorYM, player.floorYM)
      ) mob = null;
    }

    const distM = mob
      ? Math.sqrt(
          (player.x - mob.x) * (player.x - mob.x) +
          (player.y - mob.y) * (player.y - mob.y),
        ) / PX_PER_M
      : Number.POSITIVE_INFINITY;
    const target = mob ? buildTargetState(mob) : null;

    const rejection = validateCast(def, caster, target, distM, nowMicros);
    if (rejection || !def) {
      reject(rejection ?? 'unknownAbility');
      return;
    }

    // Seeded exactly like the loot rolls (lootSeedFromKill): deterministic for
    // a given (caster, ability, target, microsecond), unpredictable in practice.
    const rng = mulberry32(
      seedFrom(String(player.identity), abilityId, targetMobId, nowMicros),
    );
    // The resolver throws on malformed dot/hot content (tickSec <= 0) and on an
    // unhandled effect kind. A throw inside a reducer panics the module and
    // aborts the transaction, so content that goes bad degrades to a rejection
    // the client can render instead of taking the module down (review L-3).
    let outcome;
    try {
      outcome = resolveCast(rng, def, caster, target, nowMicros);
    } catch {
      reject('resolveFailed');
      return;
    }

    // ── Apply damage / heals ────────────────────────────────────────────────
    let damageTotal = 0;
    let healTotal = 0;
    for (const effect of outcome.effects) {
      if (effect.kind === 'damage') {
        damageTotal += effect.amount;
        emitCombatEvent(ctx, {
          at: nowMicros,
          actor: player.identity,
          abilityId,
          // Same normalisation as the aura event below: a self-cast issued
          // with a stale mob id must not publish damage against a mob that
          // was never targeted (review L-2).
          targetMobId: mob ? targetMobId : 0n,
          // 'hit' | 'crit' | 'miss' | 'dodge' come straight from the hit table.
          kind: effect.hit as CombatEventKind,
          amount: effect.amount,
        });
      } else if (effect.kind === 'heal') {
        healTotal += effect.amount;
        emitCombatEvent(ctx, {
          at: nowMicros,
          actor: player.identity,
          abilityId,
          targetMobId: 0n,
          kind: 'healed',
          amount: effect.amount,
        });
      }
    }

    const aurasPlaced = applyResolvedAuras(ctx, outcome.effects, {
      abilityId,
      casterIdentity: player.identity,
      targetMobId: mob ? targetMobId : 0n,
      nowMicros,
    });
    if (aurasPlaced > 0) {
      emitCombatEvent(ctx, {
        at: nowMicros,
        actor: player.identity,
        abilityId,
        targetMobId: mob ? targetMobId : 0n,
        kind: 'aura',
        amount: aurasPlaced,
      });
    }

    // ── Caster bookkeeping ──────────────────────────────────────────────────
    const cooldowns = caster.cooldownsMicros;
    if (def.cooldownSec > 0) cooldowns[abilityId] = outcome.cooldownUntilMicros;
    const healedHp = healTotal > 0
      ? Math.min(player.maxHp, player.hp + healTotal)
      : player.hp;

    ctx.db.player.identity.update({
      ...player,
      hp: healedHp,
      resource: Math.max(0, Math.min(resourceMax, resourceNow - outcome.resourceSpent)),
      resourceMax,
      lastGcdAt: outcome.gcdUntilMicros,
      abilityCooldowns: serializeCooldowns(cooldowns, nowMicros),
      // Regen accrues from this instant; see regeneratedResource().
      lastRegenAt: nowMicros,
      // The anti-spam floor is charged on success as well as on rejection, so
      // the cadence is the same whichever way the cast went.
      lastAttackAt: nowMicros,
    });

    // ── Target bookkeeping ──────────────────────────────────────────────────
    if (mob && damageTotal > 0) {
      const newHp = mob.hp - damageTotal;
      if (newHp <= 0) {
        applyMobKill(
          ctx,
          player.identity,
          mob,
          nowMicros,
          (at) => ScheduleAt.time(at),
          creditKillToQuests,
          abilityId,
        );
      } else {
        ctx.db.mob.mobId.update({ ...mob, hp: newHp });
      }
    }
  }
);

/**
 * Scheduled aura tick — 1 Hz (M6 §2.4).
 *
 * Two jobs, in this order: expire, then tick. Expiry wins a tie, so an aura
 * whose last tick and expiry land in the same second does not get a free final
 * tick.
 *
 * There is deliberately NO resource-regeneration sweep here: regen is settled
 * lazily inside `castAbilityById` from `player.lastRegenAt` (D94). A sweep
 * would rescan `playerEquipped` per online player and write a row on the
 * module's hottest PUBLIC table every second whether or not anyone is playing.
 *
 * A dot's killing blow goes through the SAME shared kill path as a cast
 * (D89) — otherwise a mob that bleeds to death would drop no loot and credit
 * no quest.
 */
export const tickAuras = spacetimedb.reducer(
  {
    schedule: auraTickScheduleRow,
  },
  (ctx) => {
    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;

    // ── Player auras: hot ticks and expiry ──────────────────────────────────
    const playerRows = [...ctx.db.playerAura.iter()];
    const playerWork = partitionAuraWork(playerRows, nowMicros);
    for (const row of playerWork.expired) ctx.db.playerAura.id.delete(row.id);
    for (const row of playerWork.ticking) {
      ctx.db.playerAura.id.update({ ...row, nextTickAt: advanceTick(row, nowMicros) });
      if (row.effectKind !== 'hot') continue;
      const p = ctx.db.player.identity.find(row.owner);
      if (!p || p.hp <= 0) continue;
      const amount = Math.max(1, Math.round(row.magnitude));
      ctx.db.player.identity.update({
        ...p,
        hp: Math.min(p.maxHp, p.hp + amount),
      });
      emitCombatEvent(ctx, {
        at: nowMicros,
        actor: row.owner,
        abilityId: row.abilityId,
        targetMobId: 0n,
        kind: 'healed',
        amount,
      });
    }

    // ── Mob auras: dot ticks and expiry ─────────────────────────────────────
    const mobRows = [...ctx.db.mobAura.iter()];
    const mobWork = partitionAuraWork(mobRows, nowMicros);
    for (const row of mobWork.expired) ctx.db.mobAura.id.delete(row.id);
    // `mobWork.ticking` is a snapshot taken before the loop. When one dot's
    // tick kills the mob, `applyMobKill` -> `clearMobAuras` deletes EVERY
    // mobAura row for that mob, including rows still sitting later in this
    // snapshot. Deleting one of those a second time would depend on
    // delete-by-unique-index being idempotent in the 2.2.0 bindings; if it is
    // not, the reducer panics and the 1 Hz schedule wedges. So the ids the
    // kill path removed are recorded and skipped (review M-1).
    const removedAuraIds = new Set<bigint>();
    for (const row of mobWork.ticking) {
      if (removedAuraIds.has(row.id)) continue;
      const mob = ctx.db.mob.mobId.find(row.mobId);
      if (!mob) {
        // The mob died to something else; its auras go with it.
        ctx.db.mobAura.id.delete(row.id);
        continue;
      }
      ctx.db.mobAura.id.update({ ...row, nextTickAt: advanceTick(row, nowMicros) });
      if (row.effectKind !== 'dot') continue;
      // M9-6 closes the M6-4 review M-4 gap. `appliedBy` now records who cast
      // the dot, so a bleed-out credits a real player instead of the module's
      // own identity. Two things still have to be true before the credit half
      // runs, and both are checked rather than assumed:
      //   • the identity is not the zero default, which is what rows written
      //     by the pre-M9-6 module backfill to ("nobody applied this");
      //   • that player still has a `player` row — an applier who logged out
      //     and was reaped must not materialise wallet / stack / quest rows
      //     owned by an identity nothing will ever read again.
      // When either fails the behaviour is exactly the old one: the mob dies
      // and respawns, and nobody is credited.
      const applier = row.appliedBy;
      const creditKill =
        !Identity.zero().isEqual(applier) &&
        ctx.db.player.identity.find(applier) != null;
      const amount = Math.max(1, Math.round(row.magnitude));
      emitCombatEvent(ctx, {
        at: nowMicros,
        // The dot's caster, not `ctx.sender` — a scheduled reducer's sender is
        // the module, which no client can render a floating number for.
        actor: creditKill ? applier : ctx.sender,
        abilityId: row.abilityId,
        targetMobId: row.mobId,
        kind: 'tick',
        amount,
      });
      const newHp = mob.hp - amount;
      if (newHp <= 0) {
        for (const id of applyMobKill(
          ctx,
          creditKill ? applier : ctx.sender,
          mob,
          nowMicros,
          (at) => ScheduleAt.time(at),
          creditKillToQuests,
          row.abilityId,
          creditKill, // false only when no live player owns this dot
        )) removedAuraIds.add(id);
      } else {
        ctx.db.mob.mobId.update({ ...mob, hp: newHp });
      }
    }
  }
);

/**
 * Scheduled combat-event reap — every 5 s (M6 §2.4).
 *
 * `combatEvent` is a push channel, not a log: a client that was not connected
 * when the row appeared has no use for it. Rows older than the TTL are
 * deleted, and the count is logged so an unbounded table shows up in the logs
 * as a rising number rather than as a mystery memory graph (risk R8).
 */
export const reapCombatEvents = spacetimedb.reducer(
  {
    schedule: combatEventReapScheduleRow,
  },
  (ctx) => {
    const cutoff = ctx.timestamp.microsSinceUnixEpoch - COMBAT_EVENT_TTL_MICROS;
    const doomed: bigint[] = [];
    let remaining = 0;
    for (const row of ctx.db.combatEvent.iter()) {
      if (row.at < cutoff) doomed.push(row.id);
      else remaining++;
    }
    for (const id of doomed) ctx.db.combatEvent.id.delete(id);
    logCombat(
      `reapCombatEvents: deleted ${doomed.length}, ${remaining} live`,
    );
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// MOB AI (slice 5c)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AI tick — runs every 250 ms (4 Hz). One pass over all mobs:
 *   • If leashed past leashRadius from spawn → state='returning', step home;
 *     on home arrival snap to spawn and clear state.
 *   • Else find nearest alive online player within aggroRadius:
 *       - If found: step toward them (up to WOLF_MOVE_STEP_PX). If within
 *         melee range and off cooldown, damage them.
 *       - If not found: stand still.
 *
 * Tick math:
 *   At slice 5c scale: ~10 mobs × ~5 online players = ~50 inner iterations.
 *   Trivial. We iterate `player` in the inner loop rather than building a
 *   spatial index — adding one would be premature given the scale.
 *
 * Damage flow:
 *   Wolf bite damages the targeted player directly inside this reducer.
 *   On lethal damage we set hp=0 + deadUntil=now+5s and schedule
 *   playerRespawn for 5s out. The client's `applyPlayerUpdate` callback
 *   sees hp<=0 → renders the death overlay; movePlayer is gated on
 *   hp>0 server-side so the player can't move while dead.
 */
export const tickMobAI = spacetimedb.reducer(
  {
    // Scheduled-table reducers receive a SINGLE positional arg of the
    // table's row type. We reference the shared row builder so the
    // module-load schema validation accepts the binding.
    schedule: mobAiTickScheduleRow,
  },
  (ctx, _args) => {
    const now = ctx.timestamp.microsSinceUnixEpoch;

    // Snapshot online alive players. We do this once per tick rather than
    // per-mob to avoid re-iterating the player table for each wolf.
    const livePlayers: Array<{
      identity: any; x: number; y: number;
      dungeonInstanceId: bigint; floorYM: number;
    }> = [];
    for (const p of ctx.db.player.iter()) {
      if (!p.online) continue;
      if (p.hp <= 0) continue;
      if (p.deadUntil > now) continue;
      livePlayers.push({
        identity: p.identity,
        x: p.x,
        y: p.y,
        dungeonInstanceId: p.dungeonInstanceId,
        floorYM: p.floorYM,
      });
    }

    for (const mob of ctx.db.mob.iter()) {
      if (mob.hp <= 0) continue;
      // Per-type stats come from the shared content package. Unknown types
      // (content removed between publishes) stay inert until self-healed.
      const mobDef = MOBS[mob.mobType];
      if (!mobDef) continue;
      const moveStepPx = mobDef.moveSpeedMps * PX_PER_M * AI_TICK_DT_SEC;
      const attackCdMicros = BigInt(Math.round(mobDef.attackSpeedSec * 1_000_000));
      // Deterministic mid-roll damage until P3's seeded combat rolls land.
      const attackDamage = Math.round((mobDef.dmgMin + mobDef.dmgMax) / 2);

      // 1. Leash check — if past leash radius, return home regardless of aggro.
      const homeDx = mob.x - mob.spawnX;
      const homeDy = mob.y - mob.spawnY;
      const homeDistSq = homeDx * homeDx + homeDy * homeDy;
      const leashSq   = mob.leashRadiusPx * mob.leashRadiusPx;

      let newState = mob.state;
      let nextX = mob.x;
      let nextY = mob.y;
      let nextFloorYM = mob.floorYM;
      let nextLastAttackAt = mob.lastAttackAt;
      let nextSpawnedAt = mob.spawnedAt;
      let nextLastAoeAt = mob.lastAoeAt;
      let nextEnraged = mob.enraged;

      // One instance lookup per mob, reused for both the boss mechanics and
      // the interior nav grids below — these used to be two separate
      // dungeonInstance reads (the nav side not existing at all).
      const mobDungeon = getDungeonForInstance(ctx, mob.dungeonInstanceId);
      const bossMech = bossMechanicsFor(mobDungeon, mob);
      if (bossMech && nextSpawnedAt === 0n) nextSpawnedAt = now;
      if (bossMech) {
        nextEnraged = bossEnraged(bossMech, nextSpawnedAt, now, nextEnraged);
        if (shouldBossAoePulse(bossMech, nextLastAoeAt, now)) {
          const aoeSq = bossAoeRadiusPx(bossMech) ** 2;
          const aoeDmg = bossMech.aoePulse?.damage ?? 0;
          for (const p of livePlayers) {
            if (!isValidMobTarget(mob, p, nextFloorYM)) continue;
            const dx = p.x - mob.x;
            const dy = p.y - mob.y;
            if (dx * dx + dy * dy <= aoeSq) {
              applyMobHit(ctx, p.identity, now, aoeDmg);
            }
          }
          nextLastAoeAt = now;
        }
      }
      const dmgMult = bossMech ? bossDamageMult(bossMech, nextEnraged) : 1;
      const effectiveDamage = Math.round(attackDamage * dmgMult);

      // THIS mob's dungeon's own grids, off the DungeonDef already resolved
      // above — never a dungeon id literal. Before R21 every dungeon mob
      // stepped through Castle Ashwood's, with a zero origin offset: a
      // Barrowdeep mob (zone 2, 3 km east) resolved to no surface at all, so
      // castleInteriorResolveMove handed back its previous position and it
      // never chased or returned. A dungeon with no registered interior now
      // steps freely rather than being pinned by another dungeon's walls.
      const mobNav = interiorNavForDungeon(mobDungeon);
      if (mob.dungeonInstanceId > 0n && nextFloorYM === 0) {
        nextFloorYM = mobNav ? interiorFloorYAtPx(mobNav, mob.x, mob.y, 0) : 0;
      }

      const stepMob = (fromX: number, fromY: number, toX: number, toY: number) => {
        const step = stepToward(fromX, fromY, toX, toY, moveStepPx);
        if (!mobNav) {
          return { x: step.x, y: step.y, floorYM: nextFloorYM, arrived: step.arrived };
        }
        const slid = interiorMobStepPx(mobNav, fromX, fromY, step.x, step.y, nextFloorYM);
        return { x: slid.x, y: slid.y, floorYM: slid.floorYM, arrived: step.arrived && slid.landed };
      };

      if (mob.state === 'returning' || homeDistSq > leashSq) {
        const stepArrived = stepMob(mob.x, mob.y, mob.spawnX, mob.spawnY);
        nextX = stepArrived.x;
        nextY = stepArrived.y;
        nextFloorYM = stepArrived.floorYM;
        if (stepArrived.arrived) {
          newState = 'alive';
        } else {
          newState = 'returning';
        }
      } else {
        const aggroSq = mob.aggroRadiusPx * mob.aggroRadiusPx;
        let nearest: typeof livePlayers[number] | null = null;
        let nearestDistSq = aggroSq;
        for (const p of livePlayers) {
          if (!isValidMobTarget(mob, p, nextFloorYM)) continue;
          const dx = p.x - mob.x;
          const dy = p.y - mob.y;
          const dsq = dx * dx + dy * dy;
          if (dsq <= nearestDistSq) {
            nearest = p;
            nearestDistSq = dsq;
          }
        }

        if (nearest) {
          const meleeSq = WOLF_MELEE_RANGE_PX * WOLF_MELEE_RANGE_PX;
          const sameFloor = sameInteriorFloor(nextFloorYM, nearest.floorYM);
          if (nearestDistSq <= meleeSq && sameFloor) {
            if (now - mob.lastAttackAt >= attackCdMicros) {
              applyMobHit(ctx, nearest.identity, now, effectiveDamage);
              nextLastAttackAt = now;
            }
          } else {
            const step = stepMob(mob.x, mob.y, nearest.x, nearest.y);
            nextX = step.x;
            nextY = step.y;
            nextFloorYM = step.floorYM;
          }
          newState = 'alive';
        } else {
          newState = 'alive';
        }
      }

      if (nextX !== mob.x || nextY !== mob.y || newState !== mob.state ||
          nextLastAttackAt !== mob.lastAttackAt || nextFloorYM !== mob.floorYM ||
          nextSpawnedAt !== mob.spawnedAt || nextLastAoeAt !== mob.lastAoeAt ||
          nextEnraged !== mob.enraged) {
        ctx.db.mob.mobId.update({
          ...mob,
          x: nextX,
          y: nextY,
          floorYM: nextFloorYM,
          state: newState,
          lastAttackAt: nextLastAttackAt,
          spawnedAt: nextSpawnedAt,
          lastAoeAt: nextLastAoeAt,
          enraged: nextEnraged,
        });
      }
    }
  }
);

/**
 * Scheduled mob respawn. Fires once at `scheduledAt`; the row is auto-deleted
 * by SpacetimeDB after the reducer returns (Time variant).
 *
 * Looks up the spawn-point metadata via the module-load `spawnByNetId` map
 * and inserts a fresh mob row. If the spawn point no longer exists in the
 * manifest (e.g. tile JSON was edited to remove a spawn between publish and
 * respawn fire), the respawn is silently dropped.
 */
export const respawnMob = spacetimedb.reducer(
  {
    schedule: mobRespawnQueueRow,
  },
  (ctx, { schedule }) => {
    const spawnNetId = schedule.spawnNetId;
    const dungeonInst = schedule.dungeonInstanceId;

    if (dungeonInst > 0n) {
      const dungeonInstanceRow = ctx.db.dungeonInstance.instanceId.find(dungeonInst);
      if (!dungeonInstanceRow) return;
      // insertMobFromDungeonSpawn now takes the instance's own DungeonDef
      // directly (it used to re-derive this same row internally) — a
      // mechanical follow-through of D173 item 2's interiorLocalToPx fix,
      // not a behavior change: an instance's dungeonId is only ever written
      // by enterDungeon after that same DUNGEONS_BY_ID lookup already
      // succeeded, so this can only fail to find a dungeon for content
      // removed after the instance was created — safer to skip the respawn
      // than to insert a mob against no DungeonDef at all.
      const dungeon = DUNGEONS_BY_ID[dungeonInstanceRow.dungeonId];
      if (!dungeon) return;
      const entry = dungeonSpawnByNetId.get(spawnNetId);
      if (!entry) return;
      for (const m of ctx.db.mob.iter()) {
        if (m.spawnNetId === spawnNetId && m.dungeonInstanceId === dungeonInst) return;
      }
      insertMobFromDungeonSpawn(ctx, dungeon, entry, spawnNetId, dungeonInst, 0);
      return;
    }

    const entry = spawnByNetId.get(spawnNetId);
    if (!entry) return; // spawn point removed from manifest; drop respawn

    // Defensive: if a mob with this spawnNetId already exists (e.g. seedWorld
    // ran in parallel), don't double-insert.
    for (const m of ctx.db.mob.iter()) {
      if (m.spawnNetId === spawnNetId) return;
    }

    insertMobFromSpawn(ctx, entry, spawnNetId, 0);
  }
);

/**
 * Scheduled player respawn. Snaps the player to world origin with full HP
 * and clears deadUntil so they can move again.
 *
 * If the player disconnected during their death timer, we still process the
 * respawn — they come back alive at origin the next time they log in. This
 * matches typical MMO behavior (you don't stay dead because you alt-F4'd).
 */
export const respawnPlayer = spacetimedb.reducer(
  {
    schedule: playerRespawnQueueRow,
  },
  (ctx, { schedule }) => {
    const p = ctx.db.player.identity.find(schedule.identity);
    if (!p) return;

    const prevInstanceId = p.dungeonInstanceId;

    ctx.db.player.identity.update({
      ...p,
      x: WORLD_ORIGIN_PX,
      y: WORLD_ORIGIN_PX,
      direction: 0,
      isMoving: false,
      zoneId: resolveZone(WORLD_ORIGIN_PX, WORLD_ORIGIN_PX).zoneId,
      hp: p.maxHp > 0 ? p.maxHp : PLAYER_MAX_HP,
      deadUntil: 0n,
      dungeonInstanceId: 0n,
      floorYM: 0,
      lastMoveAt: ctx.timestamp.microsSinceUnixEpoch,
    });

    // Death clears the player's auras - a hot must not keep ticking across a
    // corpse timer (review L-4; the mob side of this is `clearMobAuras`).
    const doomedAuras: bigint[] = [];
    for (const row of ctx.db.playerAura.iter()) {
      if (row.owner.isEqual(schedule.identity)) doomedAuras.push(row.id);
    }
    for (const id of doomedAuras) ctx.db.playerAura.id.delete(id);

    if (prevInstanceId > 0n) {
      cleanupDungeonInstanceIfEmpty(ctx, prevInstanceId);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// LIFECYCLE REDUCERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called automatically when a client WebSocket connects.
 * Marks the player online if they have a row (returning player).
 */
export const clientConnected = spacetimedb.clientConnected((ctx) => {
  const existing = ctx.db.player.identity.find(ctx.sender);
  if (existing) {
    // Restart the move guard's clock at connect. This is what gives rows
    // predating lastMoveAt a real baseline — without it their first move
    // after the migration would be measured against 0. It also means a
    // reconnect tightens the next move's allowance rather than banking one.
    // M6: recompute the resource pool from the live kit + gear. Rows that
    // predate the ADD COLUMN publish arrive with resourceMax = 0 (the backfill
    // default) and would be unable to cast anything; they are filled here,
    // which is also the only place a first-ever connect can fill them.
    const resourceMax = resourceMaxFor(
      ctx, existing.identity, existing.classType, getPlayerLevel(ctx, existing.identity),
    );
    // `resource` is only a low-water mark written at cast time (D94), so the
    // stored value must be settled through the same lazy formula before it is
    // clamped — otherwise a player who fought, then walked around for a
    // minute, then reconnected would come back at their stale post-cast value
    // and lose regen that legitimately accrued while they were online.
    const resource = existing.resourceMax <= 0
      ? resourceMax                                   // migrated / new row: start full
      : regeneratedResource(                          // settle, then clamp to the live pool
          existing.resource, resourceMax, existing.lastRegenAt,
          ctx.timestamp.microsSinceUnixEpoch,
        );
    ctx.db.player.identity.update({
      ...existing,
      online: true,
      lastMoveAt: ctx.timestamp.microsSinceUnixEpoch,
      resource,
      resourceMax,
      // Regen resumes from the connect; the pool itself was settled above through
      // regeneratedResource(), so time away counts at the same D94 rate.
      lastRegenAt: ctx.timestamp.microsSinceUnixEpoch,
      // D157: backfills a row still carrying the legacy hub/training/plaza/wilderness scheme
      // (0/1/2/3) to the content ZoneDef.id — this is the only always-reached write path for a
      // player who reconnects without moving first (setPlayerInfo's existing-player branch
      // spreads ...existing and movePlayer only runs after a move); every returning player's
      // zoneId converges to the new scheme within one connect (PR #363 review, finding M2).
      zoneId: resolveZone(existing.x, existing.y).zoneId,
    });
  }
  // If no row exists, setPlayerInfo will create one.
  // Mob seeding is handled by the client invoking seedWorld() once on connect.
});

/**
 * Called automatically when a client disconnects.
 * Marks the player offline — their row persists so they can return.
 */
export const clientDisconnected = spacetimedb.clientDisconnected((ctx) => {
  const existing = ctx.db.player.identity.find(ctx.sender);
  if (existing) {
    ctx.db.player.identity.update({
      ...existing,
      online: false,
      isMoving: false,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// detectZone lived here: four hardcoded pixel rectangles (hub / training /
// plaza / wilderness) that predated the content package and shared no ids with
// it. Replaced by world/zones.ts's resolveZone (D157), which answers from the
// manifest instead.

function getPlayerLevel(ctx: any, identity: any): number {
  const row = ctx.db.playerProgress.identity.find(identity);
  return row?.worldLevel ?? 1;
}

function killObjectiveMatches(
  ctx: any,
  obj: QuestObjective,
  mob: { mobType: string; spawnNetId: string; dungeonInstanceId: bigint },
): boolean {
  if (obj.type !== 'kill' || obj.mobType !== mob.mobType) return false;
  if (obj.spawnNetIdPrefix && !mob.spawnNetId.startsWith(obj.spawnNetIdPrefix)) return false;
  if (obj.dungeonId) {
    if (mob.dungeonInstanceId === 0n) return false;
    const inst = ctx.db.dungeonInstance.instanceId.find(mob.dungeonInstanceId);
    if (!inst || inst.dungeonId !== obj.dungeonId) return false;
  }
  return true;
}

/**
 * Move from `(x, y)` toward `(tx, ty)` by at most `maxStep` px.
 * Returns the new position and whether we landed on the target.
 */
function stepToward(x: number, y: number, tx: number, ty: number, maxStep: number)
  : { x: number; y: number; arrived: boolean } {
  const dx = tx - x;
  const dy = ty - y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= maxStep) {
    return { x: tx, y: ty, arrived: true };
  }
  const k = maxStep / dist;
  return { x: x + dx * k, y: y + dy * k, arrived: false };
}

function isValidMobTarget(
  mob: { dungeonInstanceId: bigint; floorYM: number },
  player: { dungeonInstanceId: bigint; floorYM: number },
  mobFloorYM: number,
): boolean {
  if (player.dungeonInstanceId !== mob.dungeonInstanceId) return false;
  if (mob.dungeonInstanceId > 0n && !sameInteriorFloor(mobFloorYM, player.floorYM)) return false;
  return true;
}

/**
 * Apply a mob hit to a player by identity. Handles lethal damage by setting
 * hp=0, scheduling respawn, and stamping deadUntil.
 *
 * Idempotent if called twice in the same tick for the same target — second
 * call sees hp<=0 and returns early.
 *
 * M9-6: absorb shields are spent FIRST. This is the module's only
 * inbound-damage path — boss AoE pulses and wolf bites both arrive here — so
 * it is the one place an `absorb` aura can be consumed. Before M9-6 a shield
 * was placed, ticked and expired without ever stopping a point of damage.
 *
 * Order is shields-then-hp, and the shield drain is published as the existing
 * `'absorbed'` combat event (combat/events.ts) rather than inferred from the
 * hp that did not move — a fully absorbed hit changes no hp at all, so there
 * is no delta for a client to read.
 *
 * The `'absorbed'` event is anchored on the *shielded player*, so it carries
 * `targetMobId: 0n` — the module's player-anchored convention, same as the
 * `healed` events in `castAbilityById` and `tickAuras`. The mob that swung is
 * deliberately not named: the client floats any combat event with a non-zero
 * `targetMobId` over that mob, which would put the absorb number on the
 * attacker instead of on the player whose shield ate the hit.
 */
function applyMobHit(
  ctx: any,
  targetIdentity: any,
  nowMicros: bigint,
  damage: number,
): void {
  const player = ctx.db.player.identity.find(targetIdentity);
  if (!player) return;
  if (player.hp <= 0) return; // already dead

  let incoming = Math.max(0, Math.round(damage));
  if (incoming > 0) {
    const shields = consumeAbsorb(
      playerAuraRows(ctx, targetIdentity), incoming, nowMicros,
    );
    if (shields.absorbed > 0) {
      for (const { row, magnitude } of shields.drained) {
        ctx.db.playerAura.id.update({ ...row, magnitude });
      }
      // An exhausted pool is deleted, not left at 0: a spent shield must stop
      // rendering and stop costing a scan on every subsequent hit.
      for (const row of shields.spent) ctx.db.playerAura.id.delete(row.id);
      emitCombatEvent(ctx, {
        at: nowMicros,
        actor: targetIdentity,
        // The shield that ate the hit, not the ability that threw the punch —
        // the client renders this on the absorbing player.
        abilityId: shields.absorbedBy,
        targetMobId: 0n,
        kind: 'absorbed',
        amount: shields.absorbed,
      });
    }
    incoming = shields.remaining;
  }
  // Fully absorbed: no hp write at all, so no row delta fans out to every
  // subscriber for a hit that changed nothing.
  if (incoming <= 0) return;

  const newHp = player.hp - incoming;
  if (newHp <= 0) {
    const respawnAt = nowMicros + PLAYER_RESPAWN_MICROS;
    ctx.db.player.identity.update({
      ...player,
      hp: 0,
      deadUntil: respawnAt,
      isMoving: false,
    });
    ctx.db.playerRespawnQueue.insert({
      id: 0n,    // auto-inc replaces this
      scheduledAt: ScheduleAt.time(respawnAt),
      identity: targetIdentity,
    });
  } else {
    ctx.db.player.identity.update({ ...player, hp: newHp });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// QUESTS (P1)
// ─────────────────────────────────────────────────────────────────────────────
//
// Quest/NPC/waypoint *definitions* live in the bundled content package
// (src/content/, mirrored from src/features/world/content/). Only per-player
// progress is table state. Rewards (copper/items/template unlocks) are
// granted at turn-in starting in P2/P4 — in P1 a turn-in just completes the
// quest; gameXp is gated off by GAME_XP_ENABLED in the content formulas.

function findQuestRow(ctx: any, identity: any, questId: string): any | null {
  for (const q of ctx.db.playerQuest.iter()) {
    if (q.questId === questId && q.owner.isEqual(identity)) return q;
  }
  return null;
}

function parseCounts(json: string, len: number): number[] {
  return parseQuestCounts(json, len);
}

function questIsReady(
  ctx: InventoryCtx,
  identity: unknown,
  quest: QuestDef,
  counts: number[],
): boolean {
  return questReadyWithInventory(ctx, identity, quest, counts);
}

function playerInRangeOfNpc(player: { x: number; y: number }, npcId: string): boolean {
  const npc = NPCS[npcId];
  if (!npc) return false;
  const px = contentPosToPx(npc.zoneId, npc.pos);
  const dx = player.x - px.x;
  const dy = player.y - px.y;
  return dx * dx + dy * dy <= INTERACT_RANGE_PX * INTERACT_RANGE_PX;
}

/**
 * Accept a quest from its giver NPC. Quests are once-only: any existing
 * row (active, ready, or done) blocks re-acceptance. minLevel enforced
 * via playerProgress.worldLevel.
 */
export const acceptQuest = spacetimedb.reducer(
  { questId: t.string() },
  (ctx, { questId }) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player) return;
    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > nowMicros) return;

    const quest: QuestDef | undefined = QUESTS[questId];
    if (!quest) return;
    if (findQuestRow(ctx, ctx.sender, questId)) return; // already taken/done

    if (quest.requiresQuestId) {
      const prereq = findQuestRow(ctx, ctx.sender, quest.requiresQuestId);
      if (!prereq || prereq.state !== QUEST_STATE_DONE) return;
    }
    if (quest.minLevel && getPlayerLevel(ctx, ctx.sender) < quest.minLevel) return;
    if (!playerInRangeOfNpc(player, quest.giverNpcId)) return;

    const invCtx = ctx as InventoryCtx;
    const initial = effectiveQuestCounts(
      invCtx,
      ctx.sender,
      quest,
      new Array(quest.objectives.length).fill(0),
    );
    ctx.db.playerQuest.insert({
      id: 0n, // auto-inc replaces this
      owner: ctx.sender,
      questId,
      state: questIsReady(invCtx, ctx.sender, quest, initial)
        ? QUEST_STATE_READY
        : QUEST_STATE_ACTIVE,
      countsJson: JSON.stringify(initial),
      acceptedAt: nowMicros,
    });
  }
);

/** Abandon an in-progress quest (done quests are immutable history). */
export const abandonQuest = spacetimedb.reducer(
  { questId: t.string() },
  (ctx, { questId }) => {
    const row = findQuestRow(ctx, ctx.sender, questId);
    if (!row || row.state === QUEST_STATE_DONE) return;
    ctx.db.playerQuest.id.delete(row.id);
  }
);

/**
 * Turn in a ready quest at its turn-in NPC. Progress is recomputed from
 * counts server-side — the stored `ready` state is a cache, not trusted.
 */
export const turnInQuest = spacetimedb.reducer(
  { questId: t.string() },
  (ctx, { questId }) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player) return;
    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > nowMicros) return;

    const quest: QuestDef | undefined = QUESTS[questId];
    if (!quest) return;
    const row = findQuestRow(ctx, ctx.sender, questId);
    if (!row || row.state === QUEST_STATE_DONE) return;

    const counts = parseCounts(row.countsJson, quest.objectives.length);
    const invCtx = ctx as InventoryCtx;
    if (!questIsReady(invCtx, ctx.sender, quest, counts)) return;
    if (!playerInRangeOfNpc(player, quest.turnInNpcId)) return;
    if (!consumeCollectObjectives(invCtx, ctx.sender, quest)) return;

    grantQuestReward(
      invCtx,
      ctx.sender,
      player.classType,
      quest.reward,
    );
    ctx.db.playerQuest.id.update({ ...row, state: QUEST_STATE_DONE });
  }
);

/**
 * Complete a 'find' objective: the client reports arrival, the server
 * validates the player actually stands inside the waypoint radius (+2 m
 * tolerance for interpolation slop).
 */
export const reachWaypoint = spacetimedb.reducer(
  { questId: t.string(), objectiveIdx: t.u32() },
  (ctx, { questId, objectiveIdx }) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player) return;
    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > nowMicros) return;

    const quest: QuestDef | undefined = QUESTS[questId];
    if (!quest) return;
    const obj = quest.objectives[objectiveIdx];
    if (!obj || obj.type !== 'find') return;

    const row = findQuestRow(ctx, ctx.sender, questId);
    if (!row || row.state !== QUEST_STATE_ACTIVE) return;

    const wp = WAYPOINTS[obj.targetId];
    if (!wp) return;
    const px = contentPosToPx(wp.zoneId, wp.pos);
    const rangePx = (wp.radiusM + 2) * PX_PER_M;
    const dx = player.x - px.x;
    const dy = player.y - px.y;
    if (dx * dx + dy * dy > rangePx * rangePx) return;

    const counts = parseCounts(row.countsJson, quest.objectives.length);
    if (counts[objectiveIdx] >= 1) return; // already found
    counts[objectiveIdx] = 1;

    ctx.db.playerQuest.id.update({
      ...row,
      countsJson: JSON.stringify(counts),
      state: questIsReady(ctx as InventoryCtx, ctx.sender, quest, counts)
        ? QUEST_STATE_READY
        : QUEST_STATE_ACTIVE,
    });
  }
);

/**
 * Kill-credit hook, called from castAbility's kill path. Increments every
 * matching kill objective on the killer's active quests and promotes rows
 * to 'ready' when all objectives are met.
 */
function creditKillToQuests(
  ctx: any,
  identity: any,
  mob: { mobType: string; spawnNetId: string; dungeonInstanceId: bigint },
): void {
  for (const row of ctx.db.playerQuest.iter()) {
    if (row.state !== QUEST_STATE_ACTIVE) continue;
    if (!row.owner.isEqual(identity)) continue;
    const quest: QuestDef | undefined = QUESTS[row.questId];
    if (!quest) continue;

    const counts = parseCounts(row.countsJson, quest.objectives.length);
    let changed = false;
    quest.objectives.forEach((obj, i) => {
      if (killObjectiveMatches(ctx, obj, mob) && counts[i] < objectiveTarget(obj)) {
        counts[i]++;
        changed = true;
      }
    });
    if (!changed) continue;

    ctx.db.playerQuest.id.update({
      ...row,
      countsJson: JSON.stringify(counts),
      state: questIsReady(ctx as InventoryCtx, identity, quest, counts)
        ? QUEST_STATE_READY
        : QUEST_STATE_ACTIVE,
    });
  }
}

/**
 * Build a fresh mob row from a content SpawnEntry and insert it.
 * Used by both `seedWorld` (initial spawn) and `respawnMob` (post-death).
 *
 * `instanceCounter` is added to the timestamp to keep `mobId` unique across
 * multiple inserts in the same reducer call (microsSinceUnixEpoch shares
 * the same value for every insert inside one reducer).
 */
function insertMobFromSpawn(
  ctx: any,
  entry: SpawnEntry,
  netId: string,
  instanceCounter: number,
): void {
  const { spawn, mobDef, instanceIndex } = entry;
  const offset = spawnInstanceOffsetM(instanceIndex, spawn.radiusM);
  const px = contentPosToPx(spawn.zoneId, {
    x: spawn.pos.x + offset.dx,
    z: spawn.pos.z + offset.dz,
  });

  ctx.db.mob.insert({
    mobId:         ctx.timestamp.microsSinceUnixEpoch + BigInt(instanceCounter),
    mobType:       spawn.mobType,
    x:             px.x,
    y:             px.y,
    hp:            mobDef.maxHp,
    maxHp:         mobDef.maxHp,
    state:         'alive',
    spawnNetId:    netId,
    spawnX:        px.x,
    spawnY:        px.y,
    aggroRadiusPx: mobDef.aggroRadiusM * PX_PER_M,
    leashRadiusPx: mobDef.leashRadiusM * PX_PER_M,
    respawnSec:    mobDef.respawnSec,
    lastAttackAt:  0n,
    dungeonInstanceId: 0n,
    floorYM:       0,
    spawnedAt:     0n,
    lastAoeAt:     0n,
    enraged:       false,
  });
}

function insertMobFromDungeonSpawn(
  ctx: any,
  dungeon: DungeonDef,
  entry: DungeonSpawnEntry,
  netId: string,
  instanceId: bigint,
  instanceCounter: number,
): void {
  const { spawn, mobDef, instanceIndex } = entry;
  const offset = spawnInstanceOffsetM(instanceIndex, spawn.radiusM);
  const px = interiorLocalToPx(dungeon, {
    x: spawn.pos.x + offset.dx,
    z: spawn.pos.z + offset.dz,
  });

  // dungeon is the caller's own already-resolved DungeonDef for this exact
  // instance (seedDungeonInstanceMobs looks it up from the same dungeonId
  // the instance row was just created with), so no re-lookup here — this
  // used to re-derive it via a redundant ctx.db.dungeonInstance read.
  const isBoss = spawn.mobType === dungeon.bossMobType;
  const nowMicros = ctx.timestamp.microsSinceUnixEpoch;

  ctx.db.mob.insert({
    mobId:         nowMicros + BigInt(instanceCounter),
    mobType:       spawn.mobType,
    x:             px.x,
    y:             px.y,
    hp:            mobDef.maxHp,
    maxHp:         mobDef.maxHp,
    state:         'alive',
    spawnNetId:    netId,
    spawnX:        px.x,
    spawnY:        px.y,
    aggroRadiusPx: mobDef.aggroRadiusM * PX_PER_M,
    leashRadiusPx: mobDef.leashRadiusM * PX_PER_M,
    respawnSec:    mobDef.respawnSec,
    lastAttackAt:  0n,
    dungeonInstanceId: instanceId,
    floorYM:       dungeonSpawnFloorYM(spawn.netId),
    spawnedAt:     isBoss ? nowMicros : 0n,
    lastAoeAt:     0n,
    enraged:       false,
  });
}

function countInstanceMembers(ctx: any, instanceId: bigint): number {
  let n = 0;
  for (const p of ctx.db.player.iter()) {
    if (p.dungeonInstanceId === instanceId) n++;
  }
  return n;
}

function findOpenDungeonInstance(ctx: any, dungeonId: string): bigint | null {
  for (const inst of ctx.db.dungeonInstance.iter()) {
    if (inst.dungeonId !== dungeonId) continue;
    if (countInstanceMembers(ctx, inst.instanceId) < DUNGEON_MAX_PLAYERS) {
      return inst.instanceId;
    }
  }
  return null;
}

function seedDungeonInstanceMobs(ctx: any, instanceId: bigint, dungeonId: string): void {
  const dungeon = DUNGEONS_BY_ID[dungeonId];
  if (!dungeon) return;
  let counter = 0;
  for (const spawn of dungeon.spawns) {
    for (let i = 0; i < spawn.count; i++) {
      const netId = `${spawn.netId}_${i}`;
      const entry = dungeonSpawnByNetId.get(netId);
      if (!entry) continue;
      insertMobFromDungeonSpawn(ctx, dungeon, entry, netId, instanceId, counter++);
    }
  }
}

function cleanupDungeonInstanceIfEmpty(ctx: any, instanceId: bigint): void {
  if (countInstanceMembers(ctx, instanceId) > 0) return;
  for (const m of ctx.db.mob.iter()) {
    if (m.dungeonInstanceId !== instanceId) continue;
    clearMobAuras(ctx, m.mobId);
    // NON-KILL MOB DELETE: the whole instance is being torn down; its mobs go
    // with it, uncredited and without a respawn. See combat/kill.ts.
    ctx.db.mob.mobId.delete(m.mobId);
  }
  ctx.db.dungeonInstance.instanceId.delete(instanceId);
}
