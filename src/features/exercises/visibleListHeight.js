/**
 * Viewport-relative height for a locked virtual list.
 *
 * iOS can shrink `window.visualViewport` (software keyboard) while
 * `window.innerHeight` stays the layout viewport. Sizing against the layout
 * viewport then makes the only scroller taller than the visible space — and
 * because `.scroll-area.lib-list-locked` is `overflow:hidden`, the bottom of
 * the list sits behind the keyboard with no way to reach it.
 *
 * Visible bottom is `visualViewport.height + offsetTop` (layout coordinates)
 * when that API exists. The bottom nav is reserved only when it actually
 * intersects that visible band; a 200 px floor is never applied, so a short
 * landscape / keyboard viewport cannot be forced taller than the remaining
 * space.
 */
export function measureVisibleListHeight({
  wrapTop,
  navTop = Infinity,
  gap = 6,
  visualViewport,
  innerHeight,
}) {
  const vv = visualViewport;
  const visibleBottom = vv && Number.isFinite(Number(vv.height))
    ? Math.round(Number(vv.height) + (Number(vv.offsetTop) || 0))
    : innerHeight;
  const reserveNav = Number.isFinite(navTop) && navTop < visibleBottom
    ? Math.round(visibleBottom - navTop)
    : 0;
  return Math.max(0, Math.round(visibleBottom - wrapTop - reserveNav - gap));
}
