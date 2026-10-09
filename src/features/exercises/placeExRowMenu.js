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
  const vw = viewport.width;
  const vh = viewport.height;
  const menuW = menu.width;
  const menuH = menu.height;
  const safeFloor = Number.isFinite(floor) ? Math.min(floor, vh) : vh;
  const spaceBelow = safeFloor - trigger.bottom - gap;
  const flip = menuH > spaceBelow;

  let top = flip ? trigger.top - menuH - gap : trigger.bottom + gap;
  const maxTop = safeFloor - menuH;
  top = Math.min(Math.max(top, pad), Math.max(pad, maxTop));

  let right = vw - trigger.right;
  if (vw - right - menuW < pad) right = vw - menuW - pad;
  if (right < pad) right = pad;

  return { top, right, flip };
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
    viewport: { width: win.innerWidth, height: win.innerHeight },
    floor: readExRowMenuFloor(doc, win),
  });
}
