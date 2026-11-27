// Tests for lib/llm/constants.ts — derived values.

import { NOISE_MULTIPLIER } from '@/lib/llm/constants';

describe('llm/constants', () => {
  describe('NOISE_MULTIPLIER', () => {
    it('is a positive number', () => {
      expect(typeof NOISE_MULTIPLIER).toBe('number');
      expect(NOISE_MULTIPLIER).toBeGreaterThan(0);
    });

    it('equals 1 (parity — one decoy per real topic)', () => {
      expect(NOISE_MULTIPLIER).toBe(1);
    });
  });
});
