import { describe, expect, it } from 'vitest';
import { formatExPb } from '../formatExPb';

describe('formatExPb', () => {
  it('converts cardio pace min/mi to min/km by dividing, matching displayPace', () => {
    expect(formatExPb({ type: 'cardio', value: 10 }, 'metric')).toBe('6.21 min/km');
    expect(formatExPb({ type: 'Cardio Pace', value: 10 }, 'imperial')).toBe('10.00 min/mi');
  });

  it('formats a running-style Cardio Pace PB the same way for both unit systems', () => {
    expect(formatExPb({ type: 'Cardio Pace', value: 8 }, 'metric')).toBe('4.97 min/km');
    expect(formatExPb({ type: 'cardio', value: 8.5 }, 'imperial')).toBe('8.50 min/mi');
  });

  it('formats a legacy {weight} PB as 1RM', () => {
    expect(formatExPb({ weight: 185 }, 'imperial')).toBe('🏆 1RM: 185 lbs');
    expect(formatExPb({ weight: 185 }, 'metric')).toMatch(/kg/);
  });

  it('returns null when there is no PB', () => {
    expect(formatExPb(null, 'imperial')).toBeNull();
    expect(formatExPb({ type: 'cardio' }, 'metric')).toBeNull();
  });
});
