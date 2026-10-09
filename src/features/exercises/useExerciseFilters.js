import { useDeferredValue, useMemo } from 'react';
import { MUSCLE_META } from '../../data/constants';
import { getMuscleColor } from '../../utils/xp';
import { MUSCLE_OPTS, EQUIP_OPTS, muscleLabel } from './exerciseFilterOptions';
import { filterAndCount } from './filterPass';

/**
 * Memoized derivations for the exercise library tab.
 *
 * One pass builds the ranked list and the ignore-self facet counts. Search
 * is deferred (same pattern as the workout picker) so a keystroke does not
 * block on a 1,500-row walk.
 */

export const LIB_ALL_MUSCLE_OPTS = MUSCLE_OPTS;
export const LIB_ALL_EQUIP_OPTS = EQUIP_OPTS;

export function useExerciseFilters({
  allExercises,
  libSearchDebounced,
  libTypeFilters,
  libMuscleFilters,
  libEquipFilters,
  favIds,
  recentIds,
}) {
  const deferredQ = useDeferredValue(libSearchDebounced);
  const favSet = useMemo(() => new Set(favIds || []), [favIds]);
  const recentSet = useMemo(() => new Set(recentIds || []), [recentIds]);

  const pass = useMemo(
    () => filterAndCount(allExercises, {
      query: deferredQ,
      muscleSet: libMuscleFilters,
      typeSet: libTypeFilters,
      equipSet: libEquipFilters,
      favSet,
      recentSet,
    }),
    [allExercises, deferredQ, libMuscleFilters, libTypeFilters, libEquipFilters, favSet, recentSet]
  );

  const libFiltered = pass.list;
  const libMuscleCounts = pass.muscleCounts;
  const libTypeCounts = pass.typeCounts;
  const libEquipCounts = pass.equipCounts;

  const libMuscleCountsByGroup = useMemo(() => {
    const counts = new Map();
    for (const ex of allExercises) {
      const mg = (ex.muscleGroup || "").toLowerCase().trim();
      if (!mg) continue;
      counts.set(mg, (counts.get(mg) || 0) + 1);
    }
    return counts;
  }, [allExercises]);

  // Include full_body so a 3-column grid of 12 tiles has no leftover Cardio cell.
  const libMuscleCardData = useMemo(() => LIB_ALL_MUSCLE_OPTS.map(mg => {
    const meta = MUSCLE_META[mg] || {
      emoji: "",
      label: muscleLabel(mg),
      icon: "game-icons:weight-lifting-up"
    };
    return {
      mg,
      label: meta.label,
      emoji: meta.emoji,
      icon: meta.icon,
      count: libMuscleCountsByGroup.get(mg) || 0,
      color: getMuscleColor(mg)
    };
  }).filter(d => d.count > 0), [libMuscleCountsByGroup]);

  const libAvailableMuscles = useMemo(() => new Set(libMuscleCounts.keys()), [libMuscleCounts]);
  const libAvailableEquip = useMemo(() => new Set(libEquipCounts.keys()), [libEquipCounts]);
  const libAvailableTypes = useMemo(() => new Set(libTypeCounts.keys()), [libTypeCounts]);

  const libMuscleOpts = useMemo(() =>
    LIB_ALL_MUSCLE_OPTS.filter(m => libAvailableMuscles.has(m) || libMuscleFilters.has(m)),
    [libAvailableMuscles, libMuscleFilters]
  );
  const libEquipOpts = useMemo(() =>
    LIB_ALL_EQUIP_OPTS.filter(e => libAvailableEquip.has(e) || libEquipFilters.has(e)),
    [libAvailableEquip, libEquipFilters]
  );

  return {
    libFiltered,
    libAvailableMuscles,
    libAvailableEquip,
    libAvailableTypes,
    libMuscleCounts,
    libEquipCounts,
    libTypeCounts,
    libMuscleCountsByGroup,
    libMuscleCardData,
    libMuscleOpts,
    libEquipOpts,
  };
}
