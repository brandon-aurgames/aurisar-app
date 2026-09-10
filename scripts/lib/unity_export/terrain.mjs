import { mulberry32 } from '../../../src/features/world/worldgen/rng.js';
import { jsonBytes } from './manifest.mjs';

const TILE_COUNT = 4;
const TILE_SIZE = 512;
const RESOLUTION = 513;
const ORIGIN = -1024;
const MIN_HEIGHT = -8;
const MAX_HEIGHT = 136;
const HEIGHT_SPAN = MAX_HEIGHT - MIN_HEIGHT;
const SIDECAR_SEED = 0x5EED1000;
const SAMPLE_COUNT = 1000;
// Hash-based mountain detail is discontinuous; this is a sampled error bound,
// not the 0.005 m Unity read-back tolerance against the encoded grid.
const MAX_ANALYTIC_GRID_ERROR_M = 8;

export function terrainTiles() {
  const tiles = [];
  for (let iz = 0; iz < TILE_COUNT; iz++) {
    for (let ix = 0; ix < TILE_COUNT; ix++) {
      tiles.push({
        ix, iz,
        originM: { x: ORIGIN + ix * TILE_SIZE, z: ORIGIN + iz * TILE_SIZE },
        file: `zone1_tile_${ix}_${iz}.r16`,
      });
    }
  }
  return tiles;
}

export function terrainPaths() {
  return ['terrain/zone1_terrain.json', ...terrainTiles().map((tile) => `terrain/${tile.file}`)];
}

/** Read back LE bytes, never the analytic heights used to create them. */
export function gridHeight(files, x, z) {
  const ix = Math.min(TILE_COUNT - 1, Math.floor((x - ORIGIN) / TILE_SIZE));
  const iz = Math.min(TILE_COUNT - 1, Math.floor((z - ORIGIN) / TILE_SIZE));
  const localX = x - (ORIGIN + ix * TILE_SIZE);
  const localZ = z - (ORIGIN + iz * TILE_SIZE);
  const col = Math.min(TILE_SIZE - 1, Math.floor(localX));
  const row = Math.min(TILE_SIZE - 1, Math.floor(localZ));
  const tx = localX - col;
  const tz = localZ - row;
  const bytes = files.get(`terrain/zone1_tile_${ix}_${iz}.r16`);
  const read = (cx, rz) => MIN_HEIGHT + bytes.readUInt16LE((rz * RESOLUTION + cx) * 2) / 65535 * HEIGHT_SPAN;
  const lower = read(col, row) * (1 - tx) + read(col + 1, row) * tx;
  const upper = read(col, row + 1) * (1 - tx) + read(col + 1, row + 1) * tx;
  return lower * (1 - tz) + upper * tz;
}

export function exportTerrain(wg) {
  const files = new Map();
  const tiles = terrainTiles();
  let minMeters = Infinity;
  let maxMeters = -Infinity;
  for (const tile of tiles) {
    const bytes = Buffer.alloc(RESOLUTION * RESOLUTION * 2);
    // Integer global coordinates make shared rows/columns byte-identical.
    for (let row = 0; row < RESOLUTION; row++) {
      for (let col = 0; col < RESOLUTION; col++) {
        const x = tile.originM.x + col;
        const z = tile.originM.z + row;
        const height = wg.surfaceY(x, z);
        if (!Number.isFinite(height) || height < MIN_HEIGHT || height > MAX_HEIGHT) {
          throw new Error(`Terrain height outside [${MIN_HEIGHT}, ${MAX_HEIGHT}] m at (${x}, ${z}): ${height}`);
        }
        minMeters = Math.min(minMeters, height);
        maxMeters = Math.max(maxMeters, height);
        const encoded = Math.round((height - MIN_HEIGHT) / HEIGHT_SPAN * 65535);
        bytes.writeUInt16LE(encoded, (row * RESOLUTION + col) * 2);
      }
    }
    files.set(`terrain/${tile.file}`, bytes);
  }

  const rng = mulberry32(SIDECAR_SEED); // Independent of createWorldgen's shared stream.
  let maxAnalyticGridErrorM = 0;
  const samples = Array.from({ length: SAMPLE_COUNT }, () => {
    const x = ORIGIN + rng() * TILE_COUNT * TILE_SIZE;
    const z = ORIGIN + rng() * TILE_COUNT * TILE_SIZE;
    const analytic = wg.surfaceY(x, z);
    const grid = gridHeight(files, x, z);
    const error = Math.abs(analytic - grid);
    if (!Number.isFinite(error) || error > MAX_ANALYTIC_GRID_ERROR_M) {
      throw new Error(`Terrain analytic/grid error exceeds ${MAX_ANALYTIC_GRID_ERROR_M} m at (${x}, ${z}): ${error}`);
    }
    maxAnalyticGridErrorM = Math.max(maxAnalyticGridErrorM, error);
    return { x, z, analytic, grid };
  });
  if (maxAnalyticGridErrorM > 4) {
    console.warn(`Warning: terrain max |analytic - grid| = ${maxAnalyticGridErrorM} m exceeds 4 m (hard limit 8 m).`);
  }
  const sidecar = {
    schemaVersion: 1,
    tileSizeM: TILE_SIZE,
    heightmapResolution: RESOLUTION,
    heightRange: { minMeters: MIN_HEIGHT, maxMeters: MAX_HEIGHT },
    originM: { x: ORIGIN, z: ORIGIN },
    tiles,
    samples,
  };
  files.set('terrain/zone1_terrain.json', jsonBytes(sidecar));
  return { files, minMeters, maxMeters, maxAnalyticGridErrorM };
}
