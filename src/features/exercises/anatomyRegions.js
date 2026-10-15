import { muscleLabel } from './exerciseFilterOptions';

/**
 * Catalog muscle groups ↔ stylized front/back regions.
 *
 * Anterior muscles live on the front figure, posterior on the back.
 * Shoulders, traps, forearms and calves have matching regions on both
 * views so a tap highlights every region that belongs to that group.
 *
 * `full_body` and `cardio` are not on the map — Browse all covers them.
 */

export const REGION_TO_MUSCLE = {
  chest: "chest",
  shoulders: "shoulder",
  biceps: "bicep",
  triceps: "tricep",
  abs: "abs",
  quads: "legs",
  hamstrings: "legs",
  glutes: "glutes",
  calves: "calves",
  lats: "back",
  "lower-back": "back",
  traps: "back",
  forearms: "forearm",
};

export const MUSCLE_TO_REGIONS = {
  chest: ["chest"],
  shoulder: ["shoulders"],
  bicep: ["biceps"],
  tricep: ["triceps"],
  abs: ["abs"],
  legs: ["quads", "hamstrings"],
  glutes: ["glutes"],
  calves: ["calves"],
  back: ["lats", "lower-back", "traps"],
  forearm: ["forearms"],
};

/** Views a region is drawn on. Posterior muscles never appear on the front. */
export const REGION_VIEWS = {
  chest: ["front"],
  shoulders: ["front", "back"],
  biceps: ["front"],
  triceps: ["back"],
  abs: ["front"],
  quads: ["front"],
  hamstrings: ["back"],
  glutes: ["back"],
  calves: ["front", "back"],
  lats: ["back"],
  "lower-back": ["back"],
  traps: ["front", "back"],
  forearms: ["front", "back"],
};

export const MAP_MUSCLES = [
  "chest", "back", "shoulder", "bicep", "tricep",
  "legs", "glutes", "abs", "calves", "forearm",
];

export function regionsForMuscle(mg) {
  return MUSCLE_TO_REGIONS[mg] || [];
}

export function muscleForRegion(region) {
  return REGION_TO_MUSCLE[region] || null;
}

export function isRegionSelected(region, selectedMuscle) {
  if (!selectedMuscle) return false;
  return (MUSCLE_TO_REGIONS[selectedMuscle] || []).includes(region);
}

export function anatomyFallbackViews(mg) {
  const regions = regionsForMuscle(mg);
  const views = new Set();
  for (const r of regions) {
    for (const v of REGION_VIEWS[r] || []) views.add(v);
  }
  return [...views];
}

export function mapMuscleLabel(mg) {
  return muscleLabel(mg);
}
