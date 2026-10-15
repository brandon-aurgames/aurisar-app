import { describe, expect, it } from 'vitest';
import { formatPbValue } from '../formatPbValue';

const CASES = [
  { name: 'Heaviest Weight', pb: { type: 'Heaviest Weight', value: 185 }, imperial: '185 lbs', metric: '83.9 kg' },
  { name: 'Max Reps Per 1 Set', pb: { type: 'Max Reps Per 1 Set', value: 25 }, imperial: '25 reps', metric: '25 reps' },
  { name: 'Assisted Weight', pb: { type: 'Assisted Weight', value: 45 }, imperial: '45 lbs (Assisted)', metric: '20.4 kg (Assisted)' },
  { name: 'Strength 1RM', pb: { type: 'Strength 1RM', value: 225 }, imperial: '225 lbs', metric: '102.0 kg' },
  { name: 'Cardio Pace', pb: { type: 'Cardio Pace', value: 10 }, imperial: '10.00 min/mi', metric: '6.21 min/km' },
  { name: 'Longest Hold', pb: { type: 'Longest Hold', value: 1.5 }, imperial: '1.5 min', metric: '1.5 min' },
  { name: 'Fastest Time', pb: { type: 'Fastest Time', value: 3 }, imperial: '3 min', metric: '3 min' },
  { name: 'legacy {weight}', pb: { weight: 185 }, imperial: '185 lbs', metric: '83.9 kg' },
  { name: 'legacy {type:cardio}', pb: { type: 'cardio', value: 9.03 }, imperial: '9.03 min/mi', metric: '5.61 min/km' },
  { name: 'legacy {type:assisted}', pb: { type: 'assisted', value: 45 }, imperial: '45 lbs (Assisted)', metric: '20.4 kg (Assisted)' },
];

describe('formatPbValue', () => {
  it('returns exact strings for every emitted type and legacy shape, imperial and metric', () => {
    const seen = [];
    for (const row of CASES) {
      const imperial = formatPbValue(row.pb, 'imperial');
      const metric = formatPbValue(row.pb, 'metric');
      expect(imperial, row.name + ' imperial').toBe(row.imperial);
      expect(metric, row.name + ' metric').toBe(row.metric);
      seen.push(imperial, metric);
    }
    for (const out of seen) {
      expect(out).not.toMatch(/undefined|NaN|1RM|🏆/);
    }
  });

  it('returns null for missing PBs', () => {
    expect(formatPbValue(null, 'imperial')).toBeNull();
    expect(formatPbValue({ type: 'Cardio Pace' }, 'metric')).toBeNull();
  });
});
