/**
 * Places the custom-row ⋯ menu in the viewport.
 *
 * Available space below the trigger is the distance to the staging tray
 * (when present) or the bottom nav — not raw innerHeight, or the menu
 * opens under those bars. Flip up when that space is shorter than the
 * menu; clamp so the panel stays inside the horizontal viewport.
 */

export const EX_ROW_MENU_GAP = 4;
export const EX_ROW_MENU_PAD = 8;
export const EX_ROW_MENU_FALLBACK = { width: 160, height: 144 };

export function readExRowMenuFloor(doc = document, win = window) {
  const tray = doc.querySelector(".cart-tray");
  if (tray) return tray.getBoundingClientRect().top;
  const nav = doc.querySelector(".hud-nav-panel") || doc.querySelector(".tabs");
  if (nav) return nav.getBoundingClientRect().top;
  return win.innerHeight;
}

export function placeExRowMenu({
  trigger,
  menu,
  viewport,
  floor,
  gap = EX_ROW_MENU_GAP,
  pad = EX_ROW_MENU_PAD,
}) {
  // viewport is the *visible* rect (visualViewport) in layout-viewport
  // coordinates, which is what position:fixed and getBoundingClientRect use.
  const offsetTop = viewport.offsetTop || 0;
  const offsetLeft = viewport.offsetLeft || 0;
  const visBottom = offsetTop + viewport.height;
  const visRight = offsetLeft + viewport.width;
  const layoutWidth = viewport.layoutWidth ?? visRight;
  const menuW = menu.width;
  const safeFloor = Number.isFinite(floor) ? Math.min(floor, visBottom) : visBottom;
  const minTop = offsetTop + pad;
  // The panel scrolls when the visible area is shorter than it is.
  const maxHeight = Math.max(0, safeFloor - minTop - pad);
  const menuH = Math.min(menu.height, maxHeight);
  const spaceBelow = safeFloor - trigger.bottom - gap;
  const flip = menuH > spaceBelow;

  let top = flip ? trigger.top - menuH - gap : trigger.bottom + gap;
  const maxTop = safeFloor - menuH;
  top = Math.min(Math.max(top, minTop), Math.max(minTop, maxTop));

  let menuRight = Math.min(trigger.right, visRight - pad);
  menuRight = Math.max(menuRight, offsetLeft + pad + menuW);
  const right = layoutWidth - menuRight;

  return { top, right, flip, maxHeight };
}

export function visibleViewport(doc = document, win = window) {
  const vv = win.visualViewport;
  const layoutWidth = doc.documentElement?.clientWidth || win.innerWidth;
  if (!vv) return { width: win.innerWidth, height: win.innerHeight, offsetTop: 0, offsetLeft: 0, layoutWidth };
  return {
    width: vv.width,
    height: vv.height,
    offsetTop: vv.offsetTop || 0,
    offsetLeft: vv.offsetLeft || 0,
    layoutWidth,
  };
}

export function measureExRowMenuPos(triggerEl, menuEl, doc = document, win = window) {
  const trigger = triggerEl.getBoundingClientRect();
  const measured = menuEl?.getBoundingClientRect();
  const menu = {
    width: measured?.width > 0 ? measured.width : EX_ROW_MENU_FALLBACK.width,
    height: measured?.height > 0 ? measured.height : EX_ROW_MENU_FALLBACK.height,
  };
  return placeExRowMenu({
    trigger,
    menu,
    viewport: visibleViewport(doc, win),
    floor: readExRowMenuFloor(doc, win),
  });
}
