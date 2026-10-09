// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Brandon P2: later equal-specificity :active scale rules beat the early
 * prefers-reduced-motion { transform: none } block. This test presses each
 * affected family under matchMedia reduce and asserts the *computed*
 * transform stays none — not a source-regex of rule presence.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const APP_CSS = readFileSync(ROOT + 'src/styles/app.css', 'utf8');

const FAMILIES = [
  { name: 'track-toggle', className: 'track-toggle-btn', label: 'Track' },
  { name: 'picker-add', className: 'wb-picker-add-btn', label: 'Add' },
  { name: 'cart-forge', className: 'cart-forge-btn', label: 'Forge' },
  { name: 'cart-forge-primary', className: 'cart-forge-btn cart-forge-primary', label: 'New Workout' },
];

function unwrapPrefersReduce(css) {
  const needle = '@media (prefers-reduced-motion: reduce)';
  let out = '';
  let i = 0;
  while (i < css.length) {
    const start = css.indexOf(needle, i);
    if (start === -1) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, start);
    let j = start + needle.length;
    while (j < css.length && /\s/.test(css[j])) j++;
    if (css[j] !== '{') {
      out += css.slice(start, j);
      i = j;
      continue;
    }
    let depth = 0;
    let k = j;
    for (; k < css.length; k++) {
      if (css[k] === '{') depth++;
      else if (css[k] === '}') {
        depth--;
        if (depth === 0) {
          k++;
          break;
        }
      }
    }
    out += css.slice(j + 1, k - 1);
    i = k;
  }
  return out;
}

function aliasActiveForJsdom(css) {
  return css.replace(/([^\s,{]+):active\b/g, '$1:active, $1[data-pressed]');
}

function installSheet({ reducedMotion }) {
  vi.stubGlobal('matchMedia', (query = '') => ({
    matches: String(query).includes('prefers-reduced-motion: reduce')
      ? reducedMotion === 'reduce'
      : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  }));
  // jsdom applies class/[attr] rules but does not honor :active from pointer
  // events, and its media-query matching for stylesheets is unreliable.
  // Alias :active → [data-pressed] and unwrap reduce blocks *in place* so
  // source order (the actual cascade bug) is preserved, then read computed
  // transform after a real press.
  let css = aliasActiveForJsdom(APP_CSS);
  if (reducedMotion === 'reduce') css = unwrapPrefersReduce(css);
  const style = document.createElement('style');
  style.setAttribute('data-rm-sheet', reducedMotion);
  style.textContent = css;
  document.head.appendChild(style);
  return style;
}

function Fixture() {
  return (
    <div>
      {FAMILIES.map((f) => (
        <button key={f.name} type="button" className={f.className}>
          {f.label}
        </button>
      ))}
    </div>
  );
}

function press(el) {
  el.setAttribute('data-pressed', '');
  fireEvent.pointerDown(el);
  fireEvent.mouseDown(el);
  fireEvent.click(el);
}

function computedTransform(el) {
  return getComputedStyle(el).transform;
}

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-rm-sheet]').forEach((n) => n.remove());
  vi.unstubAllGlobals();
});

describe('button press transform under reduced motion', () => {
  it('sanity: without reduce, a press applies a scale/transform', () => {
    installSheet({ reducedMotion: 'no-preference' });
    const { getByRole } = render(<Fixture />);
    const btn = getByRole('button', { name: 'Track' });
    expect(computedTransform(btn) === 'none' || computedTransform(btn) === '').toBe(true);
    press(btn);
    const pressed = computedTransform(btn);
    expect(pressed === 'none' || pressed === '').toBe(false);
  });

  it("presses each family with reducedMotion: 'reduce' and keeps transform none", () => {
    installSheet({ reducedMotion: 'reduce' });
    const { getByRole } = render(<Fixture />);
    for (const family of FAMILIES) {
      const btn = getByRole('button', { name: family.label });
      press(btn);
      const transform = computedTransform(btn);
      expect(transform, family.name).toBe('none');
    }
  });
});
