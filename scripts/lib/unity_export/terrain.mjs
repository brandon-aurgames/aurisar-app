import { mulberry32 } from '../../../src/features/world/worldgen/rng.js';
import { jsonBytes } from './manifest.mjs';

// Per-zone bake parameters. Only zones with an entry here have had their
// terrain baked (M10-8 adds Zone 2's Unity-side bake, keyed off this export);
// a zone missing here is skipped by the exporter rather than treated as an
// error — its terrain simply doesn't exist yet, which is the correct current
// state, not a bug.
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
  // Zone 2 (M10-7a): playable area is much smaller than zone 1's — worldgen
  // radius 360 (zone2_world.json), server accept box boundsHalfExtentM 400
  // (content/zones/manifest.ts) — so the grid is scaled down from zone 1's,
  // not copied. Same convention as zone1: resolution = tileSize + 1 (a valid
  // Unity heightmap size, 2^n+1) and origin = -(tileCount*tileSize/2).
  // tileCount*tileSize/2 = 512 m half-extent, comfortably covering the 400 m
  // accept box (28% margin) the way zone1's 1024 m grid covers its 1000 m
  // box. Height range picked from a direct surfaceY(x,z) sample sweep of the
  // zone's own footprint (step=1 m, |x|,|z| <= 512), not guessed: measured
  // min -2.6400 m at (-128, 37), max 59.9964 m at (147, 131) — mtnH's own
  // gate (`d >= M.r` in heightfield.js) caps the mountain's influence at its
  // r=165 radius, so this is the true, seed-stable range for this config;
  // sampling out to a 640 m half-extent reproduced the identical min/max,
  // confirming nothing further out grows the range. minHeight/maxHeight give
  // ~1.4 m / ~4 m of headroom over that measured range. sidecarSeed is a
  // distinct constant from zone1's so the two zones' independent RNG sample
  // streams can never collide.
  zone2: {
    tileCount: 4,
    tileSize: 256,
    resolution: 257,
    origin: -512,
    minHeight: -4,
    maxHeight: 64,
    sidecarSeed: 0x5EED2000,
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

// M10-7a: splat.mjs's sample sweep used to hardcode zone1's own extent
// (-1024 m origin, 2048 m span) because zone1 was the only baked zone. Zone
// 2's much smaller grid (see ZONE_TERRAIN.zone2 above) needs its own extent,
// so this getter is the one place both terrain.mjs and splat.mjs derive it
// from — never a second hardcoded copy.
/** Zone's baked grid extent in meters: origin (min x/z) and span (max - min). */
export function terrainExtent(zoneKey) {
  const { origin, tileCount, tileSize } = zoneConfig(zoneKey);
  return { origin, span: tileCount * tileSize };
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
