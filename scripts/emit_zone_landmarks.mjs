/**
 * emit_zone_landmarks.mjs — the single source of truth for shared world
 * positions, per zone. Runs over EVERY zone (Zone 1 and Zone 2 today; add a
 * `build*` function + a ZONES entry when Zone 3 ships).
 *
 * Before this emitter existed (Zone 1 only, `emit_zone1_landmarks.mjs`), a
 * landmark's coordinates lived in up to four unreconciled places (worldgen
 * config / content graph / castlePlan / BabylonWorldScene), and they had
 * already drifted: Stillmere was authored both as (-92,88) and (-88,82).
 * Nothing in CI compared them. M11-3 (D177) parameterized the emitter per
 * zone and gave Zone 2 the same treatment — its own header used to say
 * "Zone 2 has no generated landmark table yet"; this file is why that is no
 * longer true.
 *
 * The rule this file enforces, unchanged from the Zone-1-only original and
 * now applied to every zone:
 *
 *   A landmark is authored EXACTLY ONCE. If a truth for it already exists
 *   somewhere (a lake bowl, a plateau, a dungeon plan), the landmark is
 *   DERIVED from that truth here. Only landmarks with no other home are
 *   authored, in `<zone>_world.json` → `anchors`.
 *
 * So adding a coordinate to a zone's `anchors` that duplicates one already
 * implied by `lake` / `plateaus` / `zones` / a dungeon plan reintroduces
 * exactly the bug this exists to kill — derive it instead.
 *
 * Source of truth:
 *   Zone 1: src/features/world/config/zone1_world.json (anchors + lake/plateaus/zones)
 *           src/features/world/castle/castlePlan.js     (castle site + derived gate)
 *   Zone 2: src/features/world/config/zone2_world.json (anchors + lake/plateaus/zones)
 *           D169 (DECISIONS.md) for the Barrowdeep gate offset — there is no
 *           `barrowdeep/barrowdeepPlan.js` to import yet (that module is
 *           M11-5's job, still pending); see buildZone2Landmarks() below for
 *           the constants this mirrors and the note on retiring them once
 *           that module exists.
 * Output:
 *   src/features/world/content/zones/zone1/landmarks.generated.ts
 *   src/features/world/content/zones/zone2/landmarks.generated.ts
 *
 *   node scripts/emit_zone_landmarks.mjs
 *   node scripts/emit_zone_landmarks.mjs --check
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXTERIOR, ENTRY, INTERIOR_ANCHOR } from '../src/features/world/castle/castlePlan.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CHECK = process.argv.includes('--check');

// ── shared helpers ───────────────────────────────────────────────────────────
// Positions flow into a u32 chest key and into content the server mirrors, so
// a landmark that is silently a float artifact (e.g. 112.49999999999999) would
// be a nasty class of bug. Everything here is authored or derived from authored
// values, so 4 decimal places is exact; assert rather than assume.
const round4 = (n) => Math.round(n * 1e4) / 1e4;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function loadConfig(zoneFile) {
  const path = join(repoRoot, 'src', 'features', 'world', 'config', zoneFile);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Authored anchors: the fallback home for a landmark with no other truth. */
function authoredFromAnchors(config, configLabel, must) {
  const anchors = config.anchors ?? {};
  must(Object.keys(anchors).length > 0, `${configLabel} has no \`anchors\` section`);
  return Object.entries(anchors).map(([id, a]) => {
    must(Number.isFinite(a.x) && Number.isFinite(a.z), `anchor ${id}: x/z must be numbers`);
    must(typeof a.name === 'string' && a.name.length > 0, `anchor ${id}: missing name`);
    return { id, name: a.name, x: a.x, z: a.z, source: `${configLabel} anchors` };
  });
}

// ── Zone 1 ───────────────────────────────────────────────────────────────────
function buildZone1Landmarks(must) {
  const config = loadConfig('zone1_world.json');

  const [hubX, hubZ, hubR] = config.plateaus[0];
  const summit = config.plateaus[config.plateaus.length - 1];
  const lake = config.lake;
  const wildwood = config.zones.wildwood;

  const derived = [
    {
      id: 'hub', name: 'Oakrest',
      x: hubX, z: hubZ,
      source: `zone1_world.json plateaus[0] (hub plateau, r${hubR})`,
    },
    {
      id: 'stillmere', name: lake.name,
      x: lake.x, z: lake.z,
      source: 'zone1_world.json lake (bowl center)',
    },
    {
      id: 'wildwood', name: 'The Wildwood',
      x: wildwood.x, z: wildwood.z,
      source: 'zone1_world.json zones.wildwood',
    },
    {
      id: 'frostspire_summit', name: 'Frostspire Summit',
      x: summit[0], z: summit[1],
      source: `zone1_world.json plateaus[${config.plateaus.length - 1}] (summit shelf)`,
    },
    {
      id: 'castle_ashwood', name: 'Castle Ashwood',
      x: EXTERIOR.site.x, z: EXTERIOR.site.z,
      source: 'castle/castlePlan.js EXTERIOR.site',
    },
    {
      id: 'castle_gate', name: 'Castle Ashwood Gate',
      x: ENTRY.gateWorld.x, z: ENTRY.gateWorld.z,
      source: 'castle/castlePlan.js ENTRY.gateWorld (derived from EXTERIOR)',
    },
  ];

  const authored = authoredFromAnchors(config, 'zone1_world.json', must);

  // ── cross-checks: the hand-copies this emitter is replacing ───────────────
  // The worldgen exclusion zone is a hand-copy of the castle's exterior site.
  // Assert the copy still matches its source; a castlePlan move that silently
  // left the keep-out behind is precisely the drift class we are closing.
  const castleExclusion = (config.exclusions ?? []).find((e) => dist(e, EXTERIOR.site) < 1e-6);
  must(
    castleExclusion,
    `zone1_world.json exclusions has no entry at castlePlan EXTERIOR.site `
    + `(${EXTERIOR.site.x}, ${EXTERIOR.site.z}) — the castle keep-out drifted from the plan`,
  );

  // interiors.ashwoodCastle.cx is a hand-copy of castlePlan INTERIOR_ANCHOR.
  must(
    config.interiors?.ashwoodCastle?.cx === INTERIOR_ANCHOR.x,
    `zone1_world.json interiors.ashwoodCastle.cx (${config.interiors?.ashwoodCastle?.cx}) `
    + `!= castlePlan INTERIOR_ANCHOR.x (${INTERIOR_ANCHOR.x})`,
  );

  return [...derived, ...authored];
}

// ── Zone 2 ───────────────────────────────────────────────────────────────────
// D169's own numbers for the Barrowdeep's exterior mound: gate = site.x -
// halfW - approach margin, same z as the site (the entrance faces west, so
// only x shifts) — the identical derivation shape as Zone 1's own
// `ENTRY.gateWorld = EXTERIOR.site.x - EXTERIOR.halfW - 3.5`.
//
// There is no `barrowdeep/barrowdeepPlan.js` to import these from yet (M11-5,
// still pending) — Zone 1 imports EXTERIOR/ENTRY from castlePlan.js, but the
// Barrowdeep has no equivalent module until M11-5 lands one. These two
// constants mirror D169's verified numbers exactly. Once barrowdeepPlan.js
// exists, buildZone2Landmarks should import EXTERIOR/ENTRY from it instead of
// this block, the same way buildZone1Landmarks does for the castle — see D169
// in .orchestration/DECISIONS.md for the full derivation and its re-run
// requirement after any zone2_world.json edit.
const BARROWDEEP_HALF_W = 20;
const BARROWDEEP_GATE_MARGIN = 3.5;

function buildZone2Landmarks(must) {
  const config = loadConfig('zone2_world.json');

  const lake = config.lake;
  const wildwood = config.zones.wildwood;
  const summit = config.plateaus[config.plateaus.length - 1];
  const anchors = config.anchors ?? {};

  const derived = [
    {
      id: 'blackmere', name: lake.name,
      x: lake.x, z: lake.z,
      source: 'zone2_world.json lake (bowl center)',
    },
    // Both zones independently have a "the Wildwood" forest (zones.wildwood),
    // and — like the summit above — the emitter hardcodes the display name
    // rather than reading one from config, the same way for both. Now that
    // landmarks are cross-zone (M11-3/D177, content/index.ts's merged
    // ALL_LANDMARKS + its dupCheck('landmark id', …)), the bare id 'wildwood'
    // would collide across zones for the first time; z2_ disambiguates it the
    // same way SPAWNS netIds already do (z1_.../z2_...), rather than inventing
    // a second display name for what is genuinely the same generic concept.
    {
      id: 'z2_wildwood', name: 'The Wildwood',
      x: wildwood.x, z: wildwood.z,
      source: 'zone2_world.json zones.wildwood',
    },
    // zone2_world.json's `zones.mountain` (like zone1_world.json's own
    // `zones.mountain`) carries no `name` field — Zone 1 doesn't read one for
    // its own summit either, it hardcodes "Frostspire Summit" here in the
    // emitter. "Windward Scarp" is already this massif's own thematic name
    // (biomes[2].name; the biomeAnchors note at (120,160) — "scarp shoulder
    // under the switchback" — sits right beside it), so the summit continues
    // that name the same way Zone 1's "Frostspire Lower Gate" / "The
    // Frostspire Halls" / "Frostspire Summit" all share one massif name.
    {
      id: 'windward_scarp_summit', name: 'Windward Scarp Summit',
      x: summit[0], z: summit[1],
      source: `zone2_world.json plateaus[${config.plateaus.length - 1}] (summit shelf)`,
    },
  ];

  const barrowdeepAnchor = anchors.barrowdeep;
  must(
    barrowdeepAnchor,
    'zone2_world.json anchors has no `barrowdeep` entry (expected from M11-4/D169)',
  );
  if (barrowdeepAnchor) {
    derived.push({
      id: 'barrowdeep_gate', name: 'The Barrowdeep Gate',
      x: barrowdeepAnchor.x - BARROWDEEP_HALF_W - BARROWDEEP_GATE_MARGIN,
      z: barrowdeepAnchor.z,
      source: 'zone2_world.json anchors.barrowdeep, offset by D169\'s mound halfW '
        + '+ approach margin (mirrors castlePlan.js ENTRY.gateWorld\'s derivation)',
    });

    // Cross-check, the same drift guard as Zone 1's castle exclusion: the
    // worldgen keep-out is a hand-copy of the Barrowdeep's exterior site.
    const barrowExclusion = (config.exclusions ?? []).find((e) => dist(e, barrowdeepAnchor) < 1e-6);
    must(
      barrowExclusion,
      `zone2_world.json exclusions has no entry at anchors.barrowdeep `
      + `(${barrowdeepAnchor.x}, ${barrowdeepAnchor.z}) — the Barrowdeep keep-out drifted from its anchor`,
    );
  }

  const authored = authoredFromAnchors(config, 'zone2_world.json', must);

  return [...derived, ...authored];
}

// ── per-zone emit ────────────────────────────────────────────────────────────
const ZONES = [
  {
    key: 'zone1', label: 'Zone 1', build: buildZone1Landmarks,
    sourceComment: 'src/features/world/config/zone1_world.json (anchors) + castle/castlePlan.js',
    truthNoun: 'castle',
  },
  {
    key: 'zone2', label: 'Zone 2', build: buildZone2Landmarks,
    sourceComment: 'src/features/world/config/zone2_world.json (anchors) + D169 (Barrowdeep gate offset)',
    truthNoun: 'dungeon',
  },
];

function renderTs(zone, all) {
  const body = all
    .map((l) => `  // ${l.source}\n  ${l.id}: { id: '${l.id}', name: ${JSON.stringify(l.name)}, x: ${l.x}, z: ${l.z} },`)
    .join('\n');

  return `// GENERATED FILE — DO NOT EDIT.
// Source: ${zone.sourceComment}
// Regenerate with: node scripts/emit_zone_landmarks.mjs

/**
 * Shared ${zone.label} world positions — the single authored copy.
 *
 * Anything that needs a landmark's coordinates (waypoints, NPCs, mob camps,
 * props, dungeon entrances, the map) reads it from here rather than repeating
 * the literal. Derived entries trace back to the terrain/${zone.truthNoun} truth that
 * already owned them; authored entries live in ${zone.key}_world.json \`anchors\`.
 */
export interface LandmarkDef {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
}

export const LANDMARKS = {
${body}
} as const satisfies Record<string, LandmarkDef>;

export type LandmarkId = keyof typeof LANDMARKS;

/** All landmarks as a flat array (stable id order). */
export const ALL_LANDMARKS: readonly LandmarkDef[] = Object.values(LANDMARKS);

/** Position-only helper for the common \`{ x, z }\` shape. */
export function landmarkPos(id: LandmarkId): { x: number; z: number } {
  const l = LANDMARKS[id];
  return { x: l.x, z: l.z };
}
`;
}

function writeOrCheck(path, content, label) {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current === content) return false;
  if (CHECK) {
    console.error(`STALE: ${label}`);
    return true;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`  wrote  ${label}`);
  return false;
}

let hadErrors = false;
let anyStale = false;
const counts = [];

for (const zone of ZONES) {
  const errors = [];
  const must = (cond, msg) => { if (!cond) errors.push(msg); };

  const raw = zone.build(must);
  const all = raw.map((l) => ({ ...l, x: round4(l.x), z: round4(l.z) }));

  for (const l of all) {
    must(Number.isFinite(l.x) && Number.isFinite(l.z), `landmark ${l.id}: non-finite position`);
  }

  // Ids must be unique across the derived and authored halves — an `anchors`
  // entry that shadows a derived landmark would silently win or lose depending
  // on order, which is the ambiguity this file exists to remove.
  const seen = new Set();
  for (const l of all) {
    must(!seen.has(l.id), `duplicate landmark id "${l.id}" (authored anchor shadows a derived one?)`);
    seen.add(l.id);
  }

  // Two landmarks on top of each other almost always means a copy-paste, not
  // intent. 2 m is well inside any POI radius, so this cannot fire on real data.
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const d = dist(all[i], all[j]);
      must(d > 2, `landmarks "${all[i].id}" and "${all[j].id}" are ${d.toFixed(2)}m apart — duplicate?`);
    }
  }

  if (errors.length) {
    console.error(`Landmark emit failed for ${zone.label}:`);
    for (const e of errors) console.error(`  - ${e}`);
    hadErrors = true;
    continue;
  }

  all.sort((a, b) => a.id.localeCompare(b.id));

  const OUT_TS = join(
    repoRoot, 'src', 'features', 'world', 'content', 'zones', zone.key, 'landmarks.generated.ts',
  );
  const ts = renderTs(zone, all);
  const stale = writeOrCheck(OUT_TS, ts, OUT_TS.replace(repoRoot + '/', '').replace(/\\/g, '/'));
  if (stale) anyStale = true;
  counts.push(`${zone.label} ${all.length}`);
}

if (hadErrors) {
  process.exit(1);
}

if (CHECK && anyStale) {
  console.error('\nLandmarks out of date — run `node scripts/emit_zone_landmarks.mjs` and commit.');
  process.exit(1);
}

console.log(`Landmarks ${CHECK ? 'up to date' : 'emitted'} (${counts.join(', ')}).`);
