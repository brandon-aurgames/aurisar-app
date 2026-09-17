import { mulberry32 } from '../../../src/features/world/worldgen/rng.js';
import { jsonBytes } from './manifest.mjs';

// Per-zone bake parameters. Only zones with an entry here have had their
// terrain baked (M10-8 adds Zone 2's); a zone missing here is skipped by the
// exporter rather than treated as an error — its terrain simply doesn't
// exist yet, which is the correct current state, not a bug.
const ZONE_TERRAIN = {
  zone1: {
    tileCount: 4,
    tileSize: 512,
    resolution: 513,
    origin: -1024,
    minHeight: -8,
    maxHeight: 136,
    sidecarSeed: 0x5EED1000,
  },
};

const SAMPLE_COUNT = 1000;
// Hash-based mountain detail is discontinuous; this is a sampled error bound,
// not the 0.005 m Unity read-back tolerance against the encoded grid.
const MAX_ANALYTIC_GRID_ERROR_M = 8;

function zoneConfig(zoneKey) {
  const config = ZONE_TERRAIN[zoneKey];
  if (!config) throw new Error(`No terrain bake configuration for zone "${zoneKey}" (not baked yet).`);
  return config;
}

/** True for any zone with a registered terrain bake (see ZONE_TERRAIN above). */
export function hasTerrain(zoneKey) {
  return Object.prototype.hasOwnProperty.call(ZONE_TERRAIN, zoneKey);
}

export function terrainTiles(zoneKey = 'zone1') {
  const { tileCount, tileSize, origin } = zoneConfig(zoneKey);
  const tiles = [];
  for (let iz = 0; iz < tileCount; iz++) {
    for (let ix = 0; ix < tileCount; ix++) {
      tiles.push({
        ix, iz,
        originM: { x: origin + ix * tileSize, z: origin + iz * tileSize },
        file: `${zoneKey}_tile_${ix}_${iz}.r16`,
      });
    }
  }
  return tiles;
}

export function terrainPaths(zoneKey = 'zone1') {
  return [`terrain/${zoneKey}_terrain.json`, ...terrainTiles(zoneKey).map((tile) => `terrain/${tile.file}`)];
}

/** Read back LE bytes, never the analytic heights used to create them. */
export function gridHeight(files, x, z, zoneKey = 'zone1') {
  const { tileCount, tileSize, resolution, origin, minHeight, maxHeight } = zoneConfig(zoneKey);
  const heightSpan = maxHeight - minHeight;
  const ix = Math.min(tileCount - 1, Math.floor((x - origin) / tileSize));
  const iz = Math.min(tileCount - 1, Math.floor((z - origin) / tileSize));
  const localX = x - (origin + ix * tileSize);
  const localZ = z - (origin + iz * tileSize);
  const col = Math.min(tileSize - 1, Math.floor(localX));
  const row = Math.min(tileSize - 1, Math.floor(localZ));
  const tx = localX - col;
  const tz = localZ - row;
  const bytes = files.get(`terrain/${zoneKey}_tile_${ix}_${iz}.r16`);
  const read = (cx, rz) => minHeight + bytes.readUInt16LE((rz * resolution + cx) * 2) / 65535 * heightSpan;
  const lower = read(col, row) * (1 - tx) + read(col + 1, row) * tx;
  const upper = read(col, row + 1) * (1 - tx) + read(col + 1, row + 1) * tx;
  return lower * (1 - tz) + upper * tz;
}

export function exportTerrain(wg, zoneKey = 'zone1') {
  const { tileCount, tileSize, resolution, origin, minHeight, maxHeight, sidecarSeed } = zoneConfig(zoneKey);
  const heightSpan = maxHeight - minHeight;
  const files = new Map();
  const tiles = terrainTiles(zoneKey);
  let minMeters = Infinity;
  let maxMeters = -Infinity;
  for (const tile of tiles) {
    const bytes = Buffer.alloc(resolution * resolution * 2);
    // Integer global coordinates make shared rows/columns byte-identical.
    for (let row = 0; row < resolution; row++) {
      for (let col = 0; col < resolution; col++) {
        const x = tile.originM.x + col;
        const z = tile.originM.z + row;
        const height = wg.surfaceY(x, z);
        if (!Number.isFinite(height) || height < minHeight || height > maxHeight) {
          throw new Error(`Terrain height outside [${minHeight}, ${maxHeight}] m at (${x}, ${z}): ${height}`);
        }
        minMeters = Math.min(minMeters, height);
        maxMeters = Math.max(maxMeters, height);
        const encoded = Math.round((height - minHeight) / heightSpan * 65535);
        bytes.writeUInt16LE(encoded, (row * resolution + col) * 2);
      }
    }
    files.set(`terrain/${tile.file}`, bytes);
  }

  const rng = mulberry32(sidecarSeed); // Independent of createWorldgen's shared stream.
  let maxAnalyticGridErrorM = 0;
  const samples = Array.from({ length: SAMPLE_COUNT }, () => {
    const x = origin + rng() * tileCount * tileSize;
    const z = origin + rng() * tileCount * tileSize;
    const analytic = wg.surfaceY(x, z);
    const grid = gridHeight(files, x, z, zoneKey);
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
    tileSizeM: tileSize,
    heightmapResolution: resolution,
    heightRange: { minMeters: minHeight, maxMeters: maxHeight },
    originM: { x: origin, z: origin },
    tiles,
    samples,
  };
  files.set(`terrain/${zoneKey}_terrain.json`, jsonBytes(sidecar));
  return { files, minMeters, maxMeters, maxAnalyticGridErrorM };
}
