import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BTN, C } from '../../utils/tokens.js';

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
  });

  it('solid primary families use steel fill, not gold', () => {
    for (const sel of ['.btn-gold-solid', '.btn-gold']) {
      const block = rule(sel);
      expect(block).toMatch(/var\(--btn-steel-fill\)/);
      expect(block).not.toMatch(GOLD_FILL);
    }
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
});
