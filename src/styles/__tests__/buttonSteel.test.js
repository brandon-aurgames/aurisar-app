import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BTN, C, FG } from '../../utils/tokens.js';
import { hubGraphicsStyles, worldGraphicsStyles } from '../../features/world/ui/graphicsPanelStyles.js';

/**
 * Guards the steel button tokens: class names stay legacy (btn-gold*) so
 * WorkoutsTab.jsx and the rest of the app keep compiling, but the chrome
 * must come from --btn-steel-* (Log orb) and must not reintroduce gold fills.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const css = readFileSync(ROOT + 'src/styles/app.css', 'utf8');

function rule(selector) {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]+\\}`);
  const m = css.match(re);
  expect(m, `${selector} rule`).not.toBeNull();
  return m[0];
}

const GOLD_FILL = /#8B7425|#A89030|#FFE87C|#c49428|#C4A044|#f0d060|#8a6010|rgba\(255,232,124|rgba\(232,180,74|rgba\(196,148,40|rgba\(140,116,37/i;

describe('steel button tokens', () => {
  it('declares Log-orb steel custom properties on :root', () => {
    expect(css).toMatch(/--btn-steel-hi:\s*#3a3834/);
    expect(css).toMatch(/--btn-steel-mid:\s*#1f1d1a/);
    expect(css).toMatch(/--btn-steel-lo:\s*#141310/);
    expect(css).toMatch(/--btn-steel-fill:/);
    expect(css).toMatch(/--btn-steel-outline-fill:/);
    expect(css).toMatch(/--btn-steel-border:/);
  });

  it('JS tokens mirror the orb body colors', () => {
    expect(C.steelHi).toBe('#3a3834');
    expect(C.steelMid).toBe('#1f1d1a');
    expect(C.steelLo).toBe('#141310');
    expect(C.steelFill).toContain('#3a3834');
    expect(BTN.solid.background).toBe(C.steelFill);
    expect(BTN.outline.background).toBe(C.steelOutlineFill);
    expect(BTN.solid.color).not.toBe(BTN.outline.color);
    expect(BTN.on.background).toBe('#8FE3D2');
  });

  it('World selected/ON chrome is brighter than ghost OFF', () => {
    expect(BTN.on.background).toBe(FG.teal);
    expect(worldGraphicsStyles.optionBtnActive.background).toBe(FG.teal);
    expect(hubGraphicsStyles.optionBtnActive.background).toBe(FG.teal);
    expect(worldGraphicsStyles.optionBtn.background).not.toBe(FG.teal);
    expect(hubGraphicsStyles.optionBtn.background).not.toBe(FG.teal);
  });

  it('solid primary is the only filled steel family', () => {
    const solid = rule('.btn-gold-solid');
    expect(solid).toMatch(/var\(--btn-steel-fill\)/);
    expect(solid).not.toMatch(GOLD_FILL);
    const gold = rule('.btn-gold');
    expect(gold).toMatch(/var\(--btn-steel-outline-fill\)/);
    expect(gold).not.toMatch(/var\(--btn-steel-fill\)/);
    expect(gold).not.toMatch(GOLD_FILL);
  });

  it('outline secondary uses steel outline fill, not yellow glass', () => {
    const block = rule('.btn-glass-yellow');
    expect(block).toMatch(/var\(--btn-steel-outline-fill\)/);
    expect(block).not.toMatch(/#FFE87C/);
    expect(block).not.toMatch(GOLD_FILL);
  });

  it('keeps hover, active, and focus-visible on solid and outline families', () => {
    for (const sel of ['.btn-gold-solid', '.btn-gold', '.btn-glass-yellow']) {
      expect(css).toMatch(new RegExp(`${sel.replace('.', '\\.')}:hover\\s*\\{`));
      expect(css).toMatch(new RegExp(`${sel.replace('.', '\\.')}:active\\s*\\{`));
    }
    expect(css).toMatch(/\.btn-gold-solid:focus-visible/);
    expect(css).toMatch(/\.btn-glass-yellow:focus-visible/);
  });

  it('login primary CTA uses steel fill', () => {
    const block = rule('.au-btn');
    expect(block).toMatch(/var\(--btn-steel-fill\)/);
    expect(block).not.toMatch(/--au-accent-h/);
  });

  it('track pills and picker add use steel outline, not gold', () => {
    expect(rule('.track-toggle-btn')).toMatch(/var\(--btn-steel-outline-fill\)/);
    expect(rule('.wb-picker-add-btn')).toMatch(/var\(--btn-steel-outline-fill\)/);
    expect(rule('.cart-forge-primary')).toMatch(/var\(--btn-steel-fill\)/);
  });

  it('keeps repeated row actions as outline steel', () => {
    const quests = readFileSync(ROOT + 'src/features/quests/QuestsTab.jsx', 'utf8');
    const guild = readFileSync(ROOT + 'src/features/social/GuildTab.jsx', 'utf8');
    const history = readFileSync(ROOT + 'src/features/history/HistoryTab.jsx', 'utf8');
    expect(quests).toContain('btn btn-gold btn-sm');
    expect(quests).toContain('Claim!');
    expect(quests).not.toContain('btn-gold-solid');
    expect(guild).toContain('btn btn-gold btn-xs');
    expect(guild).toContain('+ Add');
    expect(guild).not.toContain('btn-gold-solid');
    expect(history).toContain('btn btn-gold btn-xs');
    expect(history).toContain('↩ Restore');
    expect(history).not.toContain('btn-gold-solid');
  });

  it('gives New Workout and live Finish the solid primary, Start/Log the same outline', () => {
    const workouts = readFileSync(ROOT + 'src/features/workouts/WorkoutsTab.jsx', 'utf8');
    const live = readFileSync(ROOT + 'src/components/LiveWorkoutBanner.jsx', 'utf8');
    expect(workouts).toContain('btn btn-gold-solid btn-sm');
    expect(workouts).toContain('＋ New Workout');
    expect(workouts).not.toMatch(/btn-gold-solid btn-sm\$\{live \? " on"/);
    expect(workouts).toContain('btn btn-gold btn-sm${live ? " on" : ""}');
    expect(workouts).toContain('btn btn-gold${isLiveWorkout(liveWorkout, wo) ? " on" : ""}');
    expect(workouts).toMatch(/btn btn-gold btn-sm.*\{\"Log\"\}/);
    expect(workouts).toMatch(/btn btn-gold.*\{\"Log\"\}/);
    expect(live).toContain('className="btn btn-gold-solid"');
    expect(live).toContain('handleFinishPress');
    expect(css).toMatch(/\.btn-gold\.on/);
  });

  it('keeps the final reduced-motion transform override after press-scale rules', () => {
    const scaleAt = (sel) => {
      const re = new RegExp(`${sel.replace('.', '\\.')}:active\\{[^}]*transform:scale`);
      const idx = css.search(re);
      expect(idx, `${sel}:active scale`).toBeGreaterThan(-1);
      return idx;
    };
    const lastReduce = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
    expect(lastReduce).toBeGreaterThan(scaleAt('.track-toggle-btn'));
    expect(lastReduce).toBeGreaterThan(scaleAt('.wb-picker-add-btn'));
    expect(lastReduce).toBeGreaterThan(scaleAt('.cart-forge-btn'));
    const tail = css.slice(lastReduce);
    expect(tail).toMatch(/\.track-toggle-btn:active/);
    expect(tail).toMatch(/\.wb-picker-add-btn:active/);
    expect(tail).toMatch(/\.cart-forge-btn:active/);
    expect(tail).toMatch(/\.cart-forge-primary:active/);
    expect(tail).toMatch(/transform:\s*none/);
  });
});
