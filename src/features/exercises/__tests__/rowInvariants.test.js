import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Guards for two bugs that shipped and were caught in review, not by tests.
 *
 * Both were "someone forgot to pair X with Y" rather than bad logic, and
 * neither is reachable by a normal unit test:
 *
 *   1. The stretched-overlay bug is a *layout* bug — a `::after` painting over
 *      sibling controls so clicks land on the wrong element. jsdom has no
 *      layout engine and no paint order, so even with testing-library the
 *      failure would not reproduce. Only a real browser can catch it, and only
 *      if someone thinks to look.
 *
 *   2. The picker Escape bug was a modal wired to a bare setter instead of the
 *      teardown function everything else used.
 *
 * So these assert the *pairings* at the source level. That is weaker than a
 * behavioural test — it proves the wiring exists, not that it works — but it
 * catches the way both defects actually recur: a new row or a new dismissal
 * path that forgets the safeguard.
 */

// Repo root, resolved from this file rather than the working directory so the
// guards behave the same however vitest is invoked.
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = p => readFileSync(ROOT + p, 'utf8');

const STRETCH_ROW_FILES = [
  'src/features/exercises/ExerciseRow.jsx',
  'src/features/exercises/MyWorkoutsSubTab.jsx',
];

describe('stretched-row overlay safeguard', () => {
  const css = read('src/styles/app.css');

  it('lifts every non-primary control above the overlay', () => {
    // Without this rule the ::after swallows clicks meant for the favourite,
    // edit and delete buttons — they become unusable by mouse and touch.
    expect(css).toMatch(/\.stretch-row button:not\(\.picker-ex-main\)/);
    expect(css).toMatch(/\.stretch-row\s*\{[^}]*position:\s*relative/);
  });

  it('clamps the exercise name so it cannot overflow a fixed virtualized row', () => {
    // The picker renders fixed-height react-window rows. Before the clamp, a
    // two-line name on a narrow phone overflowed its 60px slot and the cards
    // overlapped (reported on deploy-preview-362). The name button must stay
    // line-clamped so this can't come back.
    expect(css).toMatch(/\.picker-ex-main\s*\{[\s\S]*?-webkit-line-clamp:\s*2/);
  });

  it('applies .stretch-row wherever the stretched primary action is used', () => {
    for (const file of STRETCH_ROW_FILES) {
      const src = read(file);
      if (!src.includes('picker-ex-main')) continue;
      expect(
        src.includes('stretch-row'),
        `${file} uses picker-ex-main without stretch-row — its secondary controls will be unclickable`
      ).toBe(true);
    }
  });

  it('has no row using the overlay outside the audited files', () => {
    // If a third surface adopts the pattern, it must be added above so the
    // pairing is checked there too.
    const walk = d => readdirSync(ROOT + d).flatMap(n => {
      const rel = `${d}/${n}`;
      if (statSync(ROOT + rel).isDirectory()) return n === '__tests__' ? [] : walk(rel);
      return [rel];
    });

    const unaudited = ['src/features/exercises', 'src/features/workouts', 'src/components']
      .flatMap(walk)
      .filter(p => /\.jsx?$/.test(p) && read(p).includes('picker-ex-main'))
      .filter(p => !STRETCH_ROW_FILES.includes(p));
    expect(unaudited).toEqual([]);
  });
});

describe('picker dismissal runs the full teardown', () => {
  const app = read('src/App.jsx');

  it('wires the builder picker dismissal to closePicker, not a bare setter', () => {
    // useModalLifecycle(!!wbExPickerOpen, () => setWbExPickerOpen(false)) left
    // the search, filter Sets and selection populated, so reopening restored
    // the previous session's state. Escape/backdrop/X now flow through the
    // Sheet primitive's onClose — that prop must be the full closePicker
    // teardown. (The App-level lifecycle registration moved into Sheet when
    // the picker adopted it.)
    const picker = read('src/features/workouts/WorkoutExercisePicker.jsx');
    expect(picker, 'picker must dismiss via closePicker').toMatch(/onClose=\{closePicker\}/);
    expect(app.includes('useModalLifecycle(!!wbExPickerOpen'), 'stale App-level picker lifecycle should be gone').toBe(false);
  });

  it('clears every picker facet in closePicker', () => {
    // closePicker moved into WorkoutsTabContainer with the rest of the
    // builder/picker state; the teardown invariant is unchanged.
    const container = read('src/features/workouts/WorkoutsTabContainer.jsx');
    const body = container.slice(container.indexOf('function closePicker()'));
    const fn = body.slice(0, body.indexOf('\n  }') + 4);
    for (const setter of ['setPickerSearch', 'setPickerMuscle', 'setPickerTypeFilter', 'setPickerEquipFilter', 'setPickerSelected']) {
      expect(fn, `closePicker does not reset ${setter}`).toContain(setter);
    }
  });
});

describe('picker virtualizes against a definite box', () => {
  // Layout regression guard (audit finding #7): the react-window List was
  // styled height:100% inside a content-sized flex chain, so the percentage
  // resolved to `auto`, the List inflated to full content height, and every
  // one of ~1,500 rows mounted on open and re-rendered on every keystroke.
  // jsdom has no layout engine, so this can only be asserted at the source
  // level — the List must sit in a definite box, not a percentage height.
  const picker = read('src/features/workouts/WorkoutExercisePicker.jsx');

  it('gives the picker sheet a definite height so the flex chain resolves', () => {
    // A `max-height`-only (tall) sheet is content-sized; the List needs the
    // chain above it to be definite. height:100% fills the nav-padded backdrop.
    expect(picker, 'picker Sheet must set an explicit height').toMatch(/height:\s*['"]100%['"]/);
  });

  it('bounds the List in a positioned wrapper instead of a percentage height', () => {
    // The wrapper is position:relative and the List is absolutely inset, so
    // react-window measures real pixels regardless of the flex chain.
    expect(picker).toMatch(/position:\s*["']relative["']/);
    expect(picker, 'List must be absolutely inset').toMatch(/position:\s*["']absolute["'][^}]*inset:\s*0/);
    // The old, broken shape: the List styled with a percentage height. If this
    // ever comes back, the list stops virtualizing.
    expect(
      /rowComponent=\{WbPickerItem\}[\s\S]*?height:\s*['"]100%['"]/.test(picker),
      'picker List must not use a percentage height — it will not virtualize'
    ).toBe(false);
  });

  it('gives muscle-group headers a 44px touch target', () => {
    const match = picker.match(/const HEADER_H\s*=\s*(\d+)/);
    expect(match, 'HEADER_H must be declared').not.toBeNull();
    expect(Number(match[1]), 'HEADER_H must meet the 44pt iOS minimum').toBeGreaterThanOrEqual(44);
  });

  it('keeps a selected search pick visible after the query is cleared', () => {
    expect(picker).toContain('muscleKey');
    expect(picker).toMatch(/if \(searching \|\| pickerSelected\.length === 0\) return/);
  });
});

describe('library list sizes against the visual viewport', () => {
  const lib = read('src/features/exercises/ExerciseLibraryTab.jsx');

  it('measures with visualViewport and never floors at 200px', () => {
    expect(lib).toContain('measureVisibleListHeight');
    expect(lib).toContain('window.visualViewport');
    expect(lib).toMatch(/visualViewport\.resize|addEventListener\('resize'/);
    expect(lib).not.toMatch(/Math\.max\(\s*200/);
  });
});

describe('orb button is idle until hover', () => {
  const css = read('src/styles/app.css');

  it('composes the open rotation with the pressed scale', () => {
    expect(css).toMatch(/\.orb-btn\.open:active\s*\{[^}]*rotate\(90deg\)\s+scale\(/);
  });

  it('does not run a looping animation on the idle orb', () => {
    const idle = css.match(/\.orb-btn::before\{[^}]+\}/);
    expect(idle, 'orb-btn::before rule').not.toBeNull();
    expect(idle[0]).not.toMatch(/animation\s*:/);
    expect(css).not.toMatch(/\.orb-btn::after\{[^}]*animation\s*:/);
  });

  it('gates the orb ring animation to hover on fine pointers', () => {
    expect(css).toMatch(/@media \(hover:hover\) and \(pointer:fine\)[\s\S]*?\.orb-btn:hover::before\{[^}]*animation\s*:\s*orbHoverSpin/);
  });
});

describe('filter vocabulary has a single source', () => {
  it('no surface declares its own muscle or equipment option list', () => {
    // Every private copy so far has drifted. The shared module is the only
    // place these may be spelled out.
    const suspects = [
      'src/components/PlanWizard.jsx',
      'src/features/workouts/WorkoutExercisePicker.jsx',
      'src/features/exercises/ExerciseLibraryTab.jsx',
      'src/features/exercises/ExerciseEditorModal.jsx',
    ];
    for (const file of suspects) {
      const src = read(file);
      expect(src, `${file} hardcodes a muscle list`).not.toMatch(/\[\s*"chest"\s*,\s*"back"/);
      expect(src, `${file} hardcodes an equipment list`).not.toMatch(/\[\s*"barbell"\s*,\s*"dumbbell"/);
    }
  });
});
