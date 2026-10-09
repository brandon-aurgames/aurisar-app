/**
 * The overworld layout (M14-1; D232 layout, D233 rules).
 *
 * Zone 2 is laid out 340 m north of zone 1 so the two passes meet and a
 * player can walk across the seam (`crossZone`, spacetimedb/src/world/
 * layout.ts). `validateZoneLayout` holds the manifest to the seven rules
 * (a)–(g) that make that walk sound; `validateContent` runs it on the live
 * manifest, so integrity.test.ts proves it stays quiet there. This file
 * proves each rule is not simply inert, by handing the pure function broken
 * copies of the live zones — never by mocking the manifest, so nothing
 * invented here can reach the exporter or the server.
 *
 * It also pins the shipping layout's own numbers (no authored item on the
 * wrong side, the gates coinciding) and the chest exclusions that went with
 * it: 8 + 4 chests on the wrong side of the seam removed, every other site
 * and every surviving chest id untouched (D247).
 */
import { describe, expect, it } from 'vitest';

import {
  ZONES,
  ZONES_BY_ID,
  layoutItems,
  validateContent,
  validateZoneLayout,
} from '../index';
import type { LayoutItem, ZoneDef } from '../index';
import { WORLD_CHESTS } from '../world/chestManifest.generated';

// eslint-disable-next-line -- JS module without types
import { createWorldgen } from '../../worldgen/index.js';
// eslint-disable-next-line -- JSON module, no types
import zone1Config from '../../config/zone1_world.json';
// eslint-disable-next-line -- JSON module, no types
import zone2Config from '../../config/zone2_world.json';

const ZONE_1 = ZONES_BY_ID[1];
const ZONE_2 = ZONES_BY_ID[2];
const ITEMS = layoutItems();

/** A deep copy of the live zones with `edit` applied, for breaking one rule at a time. */
function zonesWith(edit: (zones: ZoneDef[]) => void): ZoneDef[] {
  const zones = structuredClone(ZONES) as ZoneDef[];
  edit(zones);
  return zones;
}
const byId = (zones: ZoneDef[], id: number) => zones.find((z) => z.id === id)!;

/** Errors from one rule, by its `layout (x):` tag. */
const rule = (errors: string[], letter: string) =>
  errors.filter((e) => e.startsWith(`layout (${letter}):`));

describe('the shipping layout (D232)', () => {
  it('zone 1 is the base and zone 2 sits at (0,+340) with region x -499..499, z -170..499', () => {
    expect(ZONE_1.layout).toEqual({ offsetM: { x: 0, z: 0 } });
    expect(ZONE_2.layout).toEqual({
      offsetM: { x: 0, z: 340 },
      regionM: { minX: -499, maxX: 499, minZ: -170, maxZ: 499 },
    });
    // Server offsets do not move (D232): only the display frame is new.
    expect(ZONE_1.originOffsetM).toEqual({ x: 0, z: 0 });
    expect(ZONE_2.originOffsetM).toEqual({ x: 3000, z: 0 });
  });

  it('passes all seven rules, and the whole content graph stays valid', () => {
    expect(validateZoneLayout(ZONES, ITEMS)).toEqual([]);
    expect(validateContent()).toEqual([]);
  });

  it('feeds rule (f) every NPC, waypoint, spawn, landmark and dungeon entrance', () => {
    const kinds = new Set(ITEMS.map((i) => i.label.split(' ')[0]));
    expect([...kinds].sort()).toEqual(['dungeon', 'landmark', 'npc', 'spawn', 'waypoint']);
    expect(ITEMS.filter((i) => i.zoneId === 1).length).toBeGreaterThan(0);
    expect(ITEMS.filter((i) => i.zoneId === 2).length).toBeGreaterThan(0);
  });
});

describe('authored content is on its own side of the seam', () => {
  // Measured here directly, not through the validator, so a validator bug
  // cannot hide a stranded item. Zone 2's region in zone 1's local frame
  // (= layout, zone 1 being the base at offset 0) is x -499..499, z 170..839.
  const region1 = { minX: -499, maxX: 499, minZ: 170, maxZ: 839 };
  const region2 = ZONE_2.layout!.regionM!;
  const reach = (it: LayoutItem, r: typeof region1) => {
    // Nearest point of the rectangle to the item's centre.
    const dx = Math.max(r.minX - it.x, 0, it.x - r.maxX);
    const dz = Math.max(r.minZ - it.z, 0, it.z - r.maxZ);
    return Math.hypot(dx, dz);
  };

  it('zone 1 authored items inside zone 2\'s region: 0 (nearest is poi_stillmere, 58 m clear)', () => {
    const z1 = ITEMS.filter((i) => i.zoneId === 1);
    const inside = z1.filter((i) => reach(i, region1) - i.radiusM < 0);
    expect(inside.map((i) => i.label)).toEqual([]);
    const nearest = z1.reduce((a, b) => (reach(a, region1) - a.radiusM <= reach(b, region1) - b.radiusM ? a : b));
    expect(nearest.label).toBe('waypoint poi_stillmere');
    expect(reach(nearest, region1) - nearest.radiusM).toBe(58);
  });

  it('zone 2 authored items outside its region: 0 (z2_bulls touches the seam at 0 m)', () => {
    const z2 = ITEMS.filter((i) => i.zoneId === 2);
    const depth = (i: LayoutItem) =>
      Math.min(i.x - region2.minX, region2.maxX - i.x, i.z - region2.minZ, region2.maxZ - i.z) - i.radiusM;
    expect(z2.filter((i) => depth(i) < 0).map((i) => i.label)).toEqual([]);
    const tightest = z2.reduce((a, b) => (depth(a) <= depth(b) ? a : b));
    expect(tightest.label).toBe('spawn z2_bulls');
    expect(depth(tightest)).toBe(0);
  });

  it('the two pass gates coincide in layout (≤ 0.01 m; exactly 0 today)', () => {
    const north = ZONE_1.gates.find((g) => g.id === 'z1_north_pass')!;
    const south = ZONE_2.gates.find((g) => g.id === 'z2_south_pass')!;
    const gap = Math.hypot(
      north.pos.x + ZONE_1.layout!.offsetM.x - (south.pos.x + ZONE_2.layout!.offsetM.x),
      north.pos.z + ZONE_1.layout!.offsetM.z - (south.pos.z + ZONE_2.layout!.offsetM.z),
    );
    expect(gap).toBeLessThanOrEqual(0.01);
    expect(gap).toBe(0);
  });
});

describe('each rule fires on a layout that breaks it', () => {
  it('(a) two base zones', () => {
    const zones = zonesWith((z) => { delete byId(z, 2).layout!.regionM; });
    expect(rule(validateZoneLayout(zones, ITEMS), 'a')).toEqual([
      'layout (a): 2 base zones (zone1, zone2); exactly one layout zone may omit regionM',
    ]);
  });

  it('(a) no base zone', () => {
    const zones = zonesWith((z) => {
      byId(z, 1).layout!.regionM = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
    });
    expect(rule(validateZoneLayout(zones, ITEMS), 'a')).toHaveLength(1);
  });

  it('(b) two regions that share an edge', () => {
    const zones = zonesWith((z) => {
      z.push({
        ...structuredClone(byId(z, 2)), id: 3, key: 'zone3', originOffsetM: { x: 6000, z: 0 }, gates: [],
        // Layout x 499..700 at zone 2's z: its west edge is zone 2's east edge.
        layout: { offsetM: { x: 600, z: 340 }, regionM: { minX: -101, maxX: 100, minZ: -170, maxZ: 0 } },
      });
    });
    expect(rule(validateZoneLayout(zones, ITEMS), 'b')).toEqual([
      'layout (b): zone zone2 and zone zone3 regions intersect',
    ]);
  });

  it('(b) is quiet for a region 1 m clear of its neighbour', () => {
    const zones = zonesWith((z) => {
      z.push({
        ...structuredClone(byId(z, 2)), id: 3, key: 'zone3', originOffsetM: { x: 6000, z: 0 }, gates: [],
        layout: { offsetM: { x: 600, z: 340 }, regionM: { minX: -100, maxX: 100, minZ: -170, maxZ: 0 } },
      });
    });
    expect(rule(validateZoneLayout(zones, ITEMS), 'b')).toEqual([]);
  });

  it('(c) a region past its own server box (zone 2 reaches 499 m)', () => {
    const zones = zonesWith((z) => { byId(z, 2).layout!.regionM!.maxX = 500; });
    expect(rule(validateZoneLayout(zones, ITEMS), 'c')).toEqual([
      'layout (c): zone zone2 region leaves its own server box (reach ±499 m)',
    ]);
  });

  it('(d) a region past the overworld grid (±1024 m)', () => {
    // Laid out 200 m further north: layout z up to 1039.
    const zones = zonesWith((z) => { byId(z, 2).layout!.offsetM.z = 540; });
    expect(rule(validateZoneLayout(zones, ITEMS), 'd')).toEqual([
      'layout (d): zone zone2 region leaves the overworld grid (±1024 m)',
    ]);
  });

  it('(e) reciprocal gates more than 0.01 m apart', () => {
    const zones = zonesWith((z) => { byId(z, 2).layout!.offsetM.z = 340.02; });
    expect(rule(validateZoneLayout(zones, ITEMS), 'e')).toEqual([
      'layout (e): gate z1_north_pass and gate z2_south_pass are 0.020 m apart in layout',
    ]);
  });

  it('(e) is quiet within 0.01 m', () => {
    const zones = zonesWith((z) => { byId(z, 2).layout!.offsetM.z = 340.005; });
    expect(rule(validateZoneLayout(zones, ITEMS), 'e')).toEqual([]);
  });

  it('(f) an authored item on the wrong side, either way, radius included', () => {
    const items: LayoutItem[] = [
      { label: 'npc stray', zoneId: 1, x: 0, z: 400, radiusM: 0 },            // deep in zone 2's region
      { label: 'spawn wide', zoneId: 1, x: 0, z: 160, radiusM: 11 },          // reaches 1 m past the seam
      { label: 'npc lost', zoneId: 2, x: 0, z: -171, radiusM: 0 },            // 1 m south of its region
      { label: 'waypoint flush', zoneId: 1, x: 0, z: 160, radiusM: 10 },      // touches: 0 m margin is allowed
      { label: 'spawn flush', zoneId: 2, x: -46, z: -150, radiusM: 20 },      // z2_bulls' own 0 m margin
    ];
    expect(rule(validateZoneLayout(ZONES, items), 'f')).toEqual([
      'layout (f): npc stray (zone zone1) reaches 230.00 m into zone zone2\'s region',
      'layout (f): spawn wide (zone zone1) reaches 1.00 m into zone zone2\'s region',
      'layout (f): npc lost (zone zone2) reaches 1.00 m outside its zone\'s region',
    ]);
  });

  it('(g) a region past the base zone\'s server box', () => {
    // An 800 m base box reaches 799 m; zone 2's region runs to layout z 839.
    const zones = zonesWith((z) => { byId(z, 1).boundsHalfExtentM = 800; });
    expect(rule(validateZoneLayout(zones, ITEMS), 'g')).toEqual([
      'layout (g): zone zone2 region leaves base zone zone1\'s server box',
    ]);
  });

  it('a zone without `layout` is not in the overworld and is skipped', () => {
    const zones = zonesWith((z) => {
      z.push({ ...structuredClone(byId(z, 2)), id: 3, key: 'zone3', originOffsetM: { x: 6000, z: 0 }, gates: [] });
      delete byId(z, 3).layout;
    });
    expect(validateZoneLayout(zones, [...ITEMS, { label: 'npc far', zoneId: 3, x: 0, z: 0, radiusM: 0 }]))
      .toEqual([]);
  });
});

describe('chest exclusions (D233): 8 + 4 wrong-side chests removed, nothing else', () => {
  const isM14 = (e: { note?: string }) => e.note?.startsWith('M14-1 (D233)') ?? false;
  const KINDS = ['trees', 'rocks', 'bushes', 'details', 'ruins', 'caves', 'chests', 'ponds'] as const;
  type Site = { x: number; z: number; id?: number };
  type Sites = Record<(typeof KINDS)[number], Site[]>;

  /** The same config without this row's exclusions — the pre-M14 site set. */
  const without = (cfg: { exclusions: { note?: string }[] }) => ({
    ...cfg, exclusions: cfg.exclusions.filter((e) => !isM14(e)),
  });
  const inZone2Region = (x: number, z: number) => {
    const r = ZONE_2.layout!.regionM!;
    return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
  };

  it.each([
    { zoneId: 1, cfg: zone1Config, added: 8, kept: 17, wrongSide: (c: Site) => inZone2Region(c.x, c.z - 340) },
    { zoneId: 2, cfg: zone2Config, added: 4, kept: 8, wrongSide: (c: Site) => !inZone2Region(c.x, c.z) },
  ])('zone $zoneId: $added exclusions, $kept chests left', ({ zoneId, cfg, added, kept, wrongSide }) => {
    expect((cfg.exclusions as { note?: string }[]).filter(isM14)).toHaveLength(added);
    const before = createWorldgen(without(cfg)).sites as Sites;
    const after = createWorldgen(cfg).sites as Sites;

    // Exactly the wrong-side chests went, and every survivor kept its id.
    const removed = before.chests.filter((c) => !after.chests.some((a) => a.id === c.id));
    expect(removed).toHaveLength(added);
    expect(removed.every(wrongSide)).toBe(true);
    expect(after.chests.some(wrongSide)).toBe(false);
    expect(after.chests).toEqual(before.chests.filter((c) => !removed.includes(c)));
    expect(after.chests).toHaveLength(kept);

    // No other site moved or vanished: the exclusion is a post-filter (D158).
    for (const kind of KINDS.filter((k) => k !== 'chests')) expect(after[kind], kind).toEqual(before[kind]);

    // And the committed manifest the server opens chests from agrees.
    const manifest = WORLD_CHESTS.filter((c) => (c.zoneId ?? 1) === zoneId);
    expect(manifest.map((c) => c.id).sort()).toEqual(after.chests.map((c) => c.id).sort());
  });
});
