import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EX_PICKER_HEADER_H,
  EX_ROW_CARD_H,
  EX_ROW_GAP,
  EX_ROW_H,
  EX_ROW_SLOT_PAD_Y,
} from '../exerciseRowLayout';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const css = readFileSync(ROOT + 'src/styles/app.css', 'utf8');

describe('exercise row height constants', () => {
  it('sizes the slot as painted card plus visible gap', () => {
    expect(EX_ROW_CARD_H).toBe(52);
    expect(EX_ROW_GAP).toBe(8);
    expect(EX_ROW_H).toBe(EX_ROW_CARD_H + EX_ROW_GAP);
    expect(EX_ROW_SLOT_PAD_Y * 2).toBe(EX_ROW_GAP);
  });

  it('keeps picker group headers at the 44px minimum', () => {
    expect(EX_PICKER_HEADER_H).toBe(44);
  });

  it('mirrors card height and gap on the CSS custom properties', () => {
    expect(css).toMatch(new RegExp(`--ex-row-card-h:\\s*${EX_ROW_CARD_H}px`));
    expect(css).toMatch(new RegExp(`--ex-row-gap:\\s*${EX_ROW_GAP}px`));
  });

  it('does not let min-height beat the slot: cards are min-height 0, height 100%, overflow hidden', () => {
    const block = css.match(/\.picker-ex-row\{[^}]+\}/);
    expect(block, '.picker-ex-row rule').not.toBeNull();
    expect(block[0]).toMatch(/min-height:\s*0/);
    expect(block[0]).toMatch(/height:\s*100%/);
    expect(block[0]).toMatch(/overflow:\s*hidden/);
    expect(block[0]).not.toMatch(/min-height:\s*56px/);
  });

  it('gives non-virtual lists the same card height and gap', () => {
    expect(css).toMatch(/\.lib-home-rows\{[^}]*gap:\s*var\(--ex-row-gap\)/);
    expect(css).toMatch(/\.lib-home-rows \.picker-ex-row\{[^}]*height:\s*var\(--ex-row-card-h\)/);
  });
});
