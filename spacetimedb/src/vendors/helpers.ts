/**
 * vendors/helpers.ts — buy/sell validation shared by vendor reducers.
 *
 * The zone-local-meters → px conversion this file used to carry its own copy
 * of now comes from world/zones.ts. That copy also skipped the Math.round the
 * other two copies applied, so `playerNearNpc` was measuring against a
 * fractional px pair while `seedWorld` placed the NPC row at the rounded one —
 * a sub-pixel disagreement inside a 192 px interact radius, but a
 * disagreement. One helper, one answer.
 */
import { NPCS } from '../content/index.js';
import { getItemDef } from '../content/items/index.js';
import { sellPriceCopper } from '../content/formulas/prices.js';
import { contentPosToPx } from '../world/zones.js';

const PX_PER_M = 32;
const INTERACT_RANGE_PX = 6 * PX_PER_M;

export function isVendorNpc(npcId: string): boolean {
  const npc = NPCS[npcId];
  return !!npc?.vendorItemIds?.length;
}

export function vendorSellsItem(npcId: string, itemId: string): boolean {
  const npc = NPCS[npcId];
  if (!npc?.vendorItemIds) return false;
  return npc.vendorItemIds.includes(itemId);
}

export function playerNearNpc(
  player: { x: number; y: number },
  npcId: string,
): boolean {
  const npc = NPCS[npcId];
  if (!npc) return false;
  const px = contentPosToPx(npc.zoneId, npc.pos);
  const dx = player.x - px.x;
  const dy = player.y - px.y;
  return dx * dx + dy * dy <= INTERACT_RANGE_PX * INTERACT_RANGE_PX;
}

export function buyPriceCopper(itemId: string): number {
  return getItemDef(itemId)?.vendorPriceCopper ?? 0;
}

export function itemSellPrice(itemId: string): number {
  const def = getItemDef(itemId);
  if (!def) return 0;
  return sellPriceCopper(def);
}

export function clampTradeQty(qty: number, maxStack: number): number {
  const q = Math.floor(qty);
  if (!Number.isFinite(q) || q <= 0) return 0;
  return Math.min(q, maxStack, 999);
}
