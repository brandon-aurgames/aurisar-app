import { describe, it, expect } from 'vitest';
import {
  EX_ROW_MENU_FALLBACK,
  EX_ROW_MENU_GAP,
  EX_ROW_MENU_PAD,
  placeExRowMenu,
  readExRowMenuFloor,
} from '../placeExRowMenu';

const menu = EX_ROW_MENU_FALLBACK;
const viewport = { width: 390, height: 844 };
const navFloor = 786;
const trayFloor = 620;

const place = (over = {}) => placeExRowMenu({
  trigger: { top: 300, right: 304, bottom: 320, left: 260, ...over.trigger },
  menu: { ...menu, ...over.menu },
  viewport: { ...viewport, ...over.viewport },
  floor: over.floor ?? navFloor,
});

describe('placeExRowMenu', () => {
  it('opens downward when the menu fits above the nav', () => {
    const pos = place();
    expect(pos.flip).toBe(false);
    expect(pos.top).toBe(320 + EX_ROW_MENU_GAP);
    expect(pos.right).toBe(viewport.width - 304);
  });

  it('flips upward when the last row would overflow the nav', () => {
    const trigger = { top: 720, right: 304, bottom: 740, left: 260 };
    const pos = place({ trigger, floor: navFloor });
    expect(pos.flip).toBe(true);
    expect(pos.top).toBe(720 - menu.height - EX_ROW_MENU_GAP);
    expect(pos.top + menu.height).toBeLessThanOrEqual(navFloor);
  });

  it('flips upward when the open tray steals the space below', () => {
    const trigger = { top: 540, right: 304, bottom: 560, left: 260 };
    const pos = place({ trigger, floor: trayFloor });
    expect(pos.flip).toBe(true);
    expect(pos.top).toBe(540 - menu.height - EX_ROW_MENU_GAP);
    expect(pos.top + menu.height).toBeLessThanOrEqual(trayFloor);
  });

  it('still opens down on the first row when the tray is open if it fits', () => {
    const pos = place({ floor: trayFloor });
    expect(pos.flip).toBe(false);
    expect(pos.top).toBe(320 + EX_ROW_MENU_GAP);
  });

  it('keeps the menu inside the horizontal viewport', () => {
    const flushRight = place({ trigger: { top: 300, right: 390, bottom: 320, left: 346 } });
    expect(flushRight.right).toBe(EX_ROW_MENU_PAD);
    expect(390 - flushRight.right - menu.width).toBeGreaterThanOrEqual(0);

    const nearLeft = place({ trigger: { top: 300, right: 50, bottom: 320, left: 6 } });
    expect(390 - nearLeft.right - menu.width).toBeGreaterThanOrEqual(EX_ROW_MENU_PAD);
    expect(nearLeft.right).toBeGreaterThanOrEqual(EX_ROW_MENU_PAD);
  });

  it('opens down when the menu fits exactly to the floor', () => {
    const bottom = navFloor - EX_ROW_MENU_GAP - menu.height;
    const pos = place({ trigger: { top: bottom - 20, right: 304, bottom, left: 260 } });
    expect(pos.flip).toBe(false);
    expect(pos.top + menu.height).toBe(navFloor);
  });
});

describe('readExRowMenuFloor', () => {
  const rect = top => ({ getBoundingClientRect: () => ({ top }) });

  it('uses the tray when it is present, otherwise the nav, otherwise the viewport', () => {
    expect(readExRowMenuFloor({
      querySelector: sel => (sel === '.cart-tray' ? rect(trayFloor) : rect(navFloor)),
    }, { innerHeight: 844 })).toBe(trayFloor);

    expect(readExRowMenuFloor({
      querySelector: sel => (sel === '.cart-tray' ? null : sel === '.hud-nav-panel' ? rect(navFloor) : null),
    }, { innerHeight: 844 })).toBe(navFloor);

    expect(readExRowMenuFloor({
      querySelector: () => null,
    }, { innerHeight: 844 })).toBe(844);
  });
});
