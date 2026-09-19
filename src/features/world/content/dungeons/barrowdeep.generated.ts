// GENERATED FILE — DO NOT EDIT.
// Regenerate with: node scripts/emit-barrowdeep-manifest.mjs

/** The zone the Barrowdeep's entrance AND interior both live in. */
export const BARROWDEEP_ZONE_ID = 2;

/**
 * Interior-local (0,0) expressed in ZONE 2's local metres (D175).
 * Exported so dungeon/helpers.ts registers it from the plan instead of
 * re-typing the literal the way CASTLE_INTERIOR_ANCHOR does.
 */
export const BARROWDEEP_INTERIOR_ANCHOR = {
  "x": 430,
  "z": 0
} as const;

export const BARROWDEEP_ENTRY = {
  "spawnLocal": {
    "x": -32.375,
    "z": 0
  },
  "spawnFacing": 1.5707963267948966,
  "exitHotspotLocal": {
    "x": -39.375,
    "z": 0
  },
  "gateWorld": {
    "x": 101.5,
    "z": -30
  }
} as const;

export const BARROWDEEP_SPAWNS = [
  {
    "netId": "bd_fore",
    "roomId": "foreHall",
    "mobType": "cairn_wight",
    "count": 4,
    "radiusM": 8,
    "pos": {
      "x": -17,
      "z": 0
    }
  },
  {
    "netId": "bd_gallery",
    "roomId": "collapsedGallery",
    "mobType": "frostbound_raider",
    "count": 4,
    "radiusM": 7,
    "pos": {
      "x": 8,
      "z": 0
    }
  },
  {
    "netId": "bd_burial",
    "roomId": "burialNorth",
    "mobType": "cairn_wight",
    "count": 4,
    "radiusM": 8,
    "pos": {
      "x": 11,
      "z": 13
    }
  },
  {
    "netId": "bd_warden",
    "roomId": "wardenCell",
    "mobType": "frostbound_raider",
    "count": 2,
    "radiusM": 6,
    "pos": {
      "x": 32,
      "z": -17
    }
  },
  {
    "netId": "bd_boss",
    "roomId": "thaneCairn",
    "mobType": "cairn_thane",
    "count": 1,
    "radiusM": 2,
    "pos": {
      "x": -17,
      "z": 0
    }
  }
] as const;
