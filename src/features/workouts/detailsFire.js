/** Small, bounded fire/smoke field. No assets, WebGL context or full-screen buffer.
 * Only runs during entry/exit; the resting rim is one stable frame plus CSS embers.
 * Fixed resolution and 24fps cap keep cost independent of viewport/DPR. */
export function createDetailsFire(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return { start() {}, stop() {}, destroy() {} };
  const w = 112, h = 384;
  canvas.width = w; canvas.height = h;
  const pixels = ctx.createImageData(w, h);
  const grid = new Float32Array(128 * 128);
  // Deterministic texture: repeatable previews, no per-frame allocations.
  let seed = 357;
  for (let i = 0; i < grid.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    grid[i] = seed / 4294967296;
  }
  const mix = (a, b, t) => a + (b - a) * t;
  function noise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const row = (iy & 127) * 128, next = ((iy + 1) & 127) * 128;
    const col = ix & 127, right = (ix + 1) & 127;
    return mix(mix(grid[row + col], grid[row + right], fx), mix(grid[next + col], grid[next + right], fx), fy);
  }
  function draw(t) {
    for (let y = 0; y < h; y++) {
      const v = y / h;
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const curl = noise(u * 4 + t * .12, v * 8 - t * .6);
        const n = noise(u * 10 + curl * 2, v * 23 - t) * .62 + noise(u * 24, v * 49 - t * 1.3) * .26 + noise(u * 51, v * 92 - t) * .12;
        const center = .18 + Math.sin(v * 13 + t * .5) * .035 + (curl - .5) * .25;
        const distance = Math.abs(u - center);
        const heat = Math.max(0, 1 - distance / (.055 + n * .26));
        // Layer a narrow hot core with feathered, turbulent sheets of vapor.
        const ridge = Math.pow(Math.max(0, 1 - Math.abs(n - .54) * 6), 2);
        const core = Math.exp(-distance * 85) * (.4 + n * .6);
        const filament = core * .32 + ridge * heat * .60 + Math.pow(heat, 1.4) * n * .30;
        const temperature = Math.min(1, core * .75 + ridge * .4 + heat * .3);
        const smoke = Math.max(0, 1 - distance / .65) * Math.pow(n, 3) * .20;
        const edgeFade = Math.min(1, v * 14, (1 - v) * 14);
        const p = (y * w + x) * 4;
        // Move from the shared teal accent toward the primary text highlight.
        pixels.data[p] = 143 + 85 * temperature;
        pixels.data[p + 1] = 227 + 4 * temperature;
        pixels.data[p + 2] = 210 + 25 * temperature;
        pixels.data[p + 3] = Math.min(220, (filament * 330 + smoke * 160) * edgeFade);
      }
    }
    ctx.putImageData(pixels, 0, 0);
  }
  let frame = 0, last = 0, until = 0;
  function stop() { cancelAnimationFrame(frame); frame = 0; }
  function tick(now) {
    if (document.hidden || now > until) { stop(); return; }
    if (now - last >= 1000 / 24) { draw(now / 1300); last = now; }
    frame = requestAnimationFrame(tick);
  }
  function start(duration = 700) {
    stop();
    if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    until = performance.now() + duration; last = 0;
    frame = requestAnimationFrame(tick);
  }
  draw(2.4);
  return { start, stop, destroy: stop };
}
