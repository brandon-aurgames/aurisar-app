import { describe, expect, it } from 'vitest';
import { builderDraftIsDirty, serializeBuilderDraft } from '../builderDraft';

const empty = {
  name: '',
  icon: '💪',
  desc: '',
  intensity: '',
  exercises: [],
  duration: '',
  durationSec: '',
  activeCal: '',
  totalCal: '',
  labels: [],
};

describe('builderDraftIsDirty', () => {
  it('is clean against its own snapshot', () => {
    const baseline = serializeBuilderDraft(empty);
    expect(builderDraftIsDirty(baseline, empty)).toBe(false);
  });

  it('detects a name-only or details-only change', () => {
    const baseline = serializeBuilderDraft(empty);
    expect(builderDraftIsDirty(baseline, { ...empty, name: 'Push' })).toBe(true);
    expect(builderDraftIsDirty(baseline, { ...empty, duration: '00:45' })).toBe(true);
  });

  it('treats a missing baseline as not dirty', () => {
    expect(builderDraftIsDirty(null, { ...empty, name: 'Push' })).toBe(false);
  });
});
