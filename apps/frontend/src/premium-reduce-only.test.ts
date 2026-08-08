import { describe, expect, it } from 'vitest';
import { premiumReduceOnlyDefaults } from './premium-reduce-only.js';

describe('premium reduce-only defaults', () => {
  it('uses exact short-SKHY and long-SKHYNIX position quantities', () => {
    expect(premiumReduceOnlyDefaults(
      { positionSide: 'SHORT', quantity: '8.3000' },
      { positionSide: 'LONG', quantity: '1.1200' },
    )).toEqual({ directionFlipped: true, adrQuantity: '8.3', hedgeQuantity: '1.12' });
  });

  it('selects the opposite close direction for long SKHY and short SKHYNIX', () => {
    expect(premiumReduceOnlyDefaults(
      { positionSide: 'LONG', quantity: '2' },
      { positionSide: 'SHORT', quantity: '0.27' },
    )).toEqual({ directionFlipped: false, adrQuantity: '2', hedgeQuantity: '0.27' });
  });

  it('rejects missing, zero, or same-direction position pairs', () => {
    expect(premiumReduceOnlyDefaults(undefined, { positionSide: 'LONG', quantity: '1' })).toBeNull();
    expect(premiumReduceOnlyDefaults(
      { positionSide: 'SHORT', quantity: '0' },
      { positionSide: 'LONG', quantity: '1' },
    )).toBeNull();
    expect(premiumReduceOnlyDefaults(
      { positionSide: 'LONG', quantity: '1' },
      { positionSide: 'LONG', quantity: '1' },
    )).toBeNull();
  });
});
