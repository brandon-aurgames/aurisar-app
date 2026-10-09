import { describe, expect, it } from 'vitest';
import { comparePbBoardValues, pbBoardValue } from '../pbBoardValue';

describe('pbBoardValue', () => {
  it('reads {type, value} and legacy shapes for weight, reps, and pace boards', () => {
    expect(pbBoardValue({ type: 'Strength 1RM', value: 225 }, 'weight')).toBe(225);
    expect(pbBoardValue({ type: 'Heaviest Weight', value: 185 }, 'weight')).toBe(185);
    expect(pbBoardValue({ weight: 185 }, 'weight')).toBe(185);

    expect(pbBoardValue({ type: 'Max Reps Per 1 Set', value: 25 }, 'reps')).toBe(25);
    expect(pbBoardValue({ reps: 45 }, 'reps')).toBe(45);

    expect(pbBoardValue({ type: 'Cardio Pace', value: 8.5 }, 'pace')).toBe(8.5);
    expect(pbBoardValue({ type: 'cardio', value: 9.03 }, 'pace')).toBe(9.03);
  });

  it('treats legacy {type:cardio} as Cardio Pace so those players appear on the pace board', () => {
    expect(pbBoardValue({ type: 'cardio', value: 7.2 }, 'pace')).toBe(7.2);
    expect(pbBoardValue({ type: 'cardio', value: 7.2 }, 'weight')).toBeNull();
  });

  it('leaves missing or non-numeric PBs off the board (never 0)', () => {
    expect(pbBoardValue(null, 'weight')).toBeNull();
    expect(pbBoardValue({ type: 'Strength 1RM' }, 'weight')).toBeNull();
    expect(pbBoardValue({ type: 'Strength 1RM', value: 'heavy' }, 'weight')).toBeNull();
    expect(pbBoardValue({ type: 'Max Reps Per 1 Set', value: NaN }, 'reps')).toBeNull();
    expect(pbBoardValue({ type: 'cardio', value: undefined }, 'pace')).toBeNull();
    expect(pbBoardValue({ weight: '' }, 'weight')).toBeNull();
  });

  it('ranks lowest first on boards where lower is better (pace and assisted)', () => {
    expect(comparePbBoardValues(7.2, 9.03, 'pace')).toBeLessThan(0);
    expect(comparePbBoardValues(9.03, 7.2, 'pace')).toBeGreaterThan(0);
    expect(comparePbBoardValues(40, 55, 'assisted')).toBeLessThan(0);
    expect(comparePbBoardValues(225, 185, 'weight')).toBeLessThan(0);
    expect(comparePbBoardValues(null, 185, 'weight')).toBeGreaterThan(0);
  });
});
