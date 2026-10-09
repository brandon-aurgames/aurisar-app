import { describe, expect, it } from 'vitest';
import { EX_PICKER_HEADER_H, EX_ROW_H, EX_ROW_SLOT_PAD_Y } from '../exerciseRowLayout';

describe('exercise row height constants', () => {
  it('keeps the virtualized exercise slot at 56px', () => {
    expect(EX_ROW_H).toBe(56);
  });

  it('keeps picker group headers at the 44px minimum', () => {
    expect(EX_PICKER_HEADER_H).toBe(44);
  });

  it('uses only hairline slot padding so 56px rows neither gap nor overlap', () => {
    expect(EX_ROW_SLOT_PAD_Y).toBeGreaterThanOrEqual(0);
    expect(EX_ROW_SLOT_PAD_Y).toBeLessThanOrEqual(2);
    expect(EX_ROW_H).toBeGreaterThan(EX_PICKER_HEADER_H);
  });
});
