import { describe, it, expect } from 'vitest';
import { measureVisibleListHeight } from '../visibleListHeight';

describe('measureVisibleListHeight', () => {
  it('uses innerHeight when visualViewport is missing', () => {
    expect(measureVisibleListHeight({
      wrapTop: 280,
      navTop: 768,
      innerHeight: 844,
    })).toBe(844 - 280 - (844 - 768) - 6);
  });

  it('sizes against visualViewport height + offsetTop (iOS keyboard)', () => {
    // Layout viewport stays 844; the keyboard shrinks the visual viewport to 500.
    // The nav sits at the bottom of the layout viewport, below the keyboard,
    // so it is not reserved.
    expect(measureVisibleListHeight({
      wrapTop: 280,
      navTop: 768,
      innerHeight: 844,
      visualViewport: { height: 500, offsetTop: 0 },
    })).toBe(500 - 280 - 6);
  });

  it('accounts for a scrolled visualViewport via offsetTop', () => {
    expect(measureVisibleListHeight({
      wrapTop: 200,
      navTop: 900,
      innerHeight: 844,
      visualViewport: { height: 400, offsetTop: 80 },
    })).toBe(480 - 200 - 6);
  });

  it('never forces a 200px floor — short leftover space stays short', () => {
    expect(measureVisibleListHeight({
      wrapTop: 430,
      navTop: 768,
      innerHeight: 844,
      visualViewport: { height: 480, offsetTop: 0 },
    })).toBe(480 - 430 - 6);
  });

  it('clamps a wrap that sits past the visible bottom to 0', () => {
    expect(measureVisibleListHeight({
      wrapTop: 520,
      navTop: 768,
      innerHeight: 844,
      visualViewport: { height: 500, offsetTop: 0 },
    })).toBe(0);
  });

  it('reserves only the nav that intersects the visible band', () => {
    expect(measureVisibleListHeight({
      wrapTop: 200,
      navTop: 700,
      innerHeight: 844,
      visualViewport: { height: 760, offsetTop: 0 },
    })).toBe(760 - 200 - (760 - 700) - 6);
  });
});
