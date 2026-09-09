import { computeGroundSplat } from '../../../src/features/world/worldgen/groundSplat.js';
import { jsonBytes } from './manifest.mjs';
import { gridHeight } from './terrain.mjs';

export const LAYER_ORDER = Object.freeze([
  'Grass_Lush', 'Grass_Dry', 'Forest_Floor', 'Dirt_Trail',
  'Sand_Shore', 'Rock_Cliff', 'Rock_Scree', 'Snow',
]);

const clamp01 = (value) => Math.max(0, Math.min(1, value));

// Same cubic smoothstep as groundSplat.js (not rng.js's differently named helpers).
function smoothstep01(e0, e1, value) {
  const t = clamp01((value - e0) / (e1 - e0 || 1));
  return t * t * (3 - 2 * t);
}

/** M4 architecture 2.2 / formulaVersion 1. No RNG, sites, or model mutation. */
export function computeUnitySplat(wg, x, z, alt) {
  // Call the web implementation with its original CONFIG-SAFE functions, but
  // supply decoded baked altitude (D51), not the analytic surfaceY/mountain noise.
  const { dirt, sand, field, bc } = computeGroundSplat({
    biomeColorAt: wg.biomeColorAt,
    trailDirtAt: wg.trailDirtAt,
    lakeShoreAt: wg.lakeShoreAt,
    mtnCliffAt: wg.mtnCliffAt,
    surfaceY: () => alt,
  }, x, z);
  const green = bc.g - 0.5 * (bc.r + bc.b);
  const stony = clamp01(1 - smoothstep01(0.02, 0.16, green));
  const cliff = wg.mtnCliffAt(x, z);
  const cliffShare = Math.max(cliff, stony * 0.65);
  const weights = [
    0,
    field,
    Number(wg.inForest(x, z)) * (1 - dirt) * (1 - sand),
    dirt,
    sand,
    cliffShare,
    // "Minus the cliff share" means subtract layer 5 before normalization;
    // clamp to zero so low-altitude cliffs cannot create negative scree.
    Math.max(0, smoothstep01(24, 60, alt) - cliffShare),
    smoothstep01(92, 112, alt),
  ];
  weights[0] = Math.max(0, 1 - weights.reduce((sum, weight) => sum + weight, 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

function halton(index, base) {
  let value = 0;
  let fraction = 1;
  while (index > 0) {
    fraction /= base;
    value += fraction * (index % base);
    index = Math.floor(index / base);
  }
  return value;
}

export function exportSplat(wg, terrainFiles) {
  // Fixed pattern over the entire exported extent; no shared or derived RNG.
  const samples = Array.from({ length: 1000 }, (_, index) => {
    const x = -1024 + 2048 * halton(index + 1, 2);
    const z = -1024 + 2048 * halton(index + 1, 3);
    const alt = gridHeight(terrainFiles, x, z);
    return { x, z, alt, weights: computeUnitySplat(wg, x, z, alt) };
  });
  return jsonBytes({
    layerOrder: LAYER_ORDER,
    formulaVersion: 1,
    samplePointRule: 'Halton indices 1..1000; x = -1024 + 2048 * H2(i); z = -1024 + 2048 * H3(i).',
    samples,
  });
}
