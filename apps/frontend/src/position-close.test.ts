import { describe, expect, it } from 'vitest';
import { closeQuantityForPercentage } from './position-close.js';

describe('position close quantity', () => {
  it('preserves the exchange position quantity at 100 percent', () => {
    expect(closeQuantityForPercentage('-33.5000', 100, '0.1')).toBe('33.5000');
  });

  it('scales and rounds down to the instrument lot size', () => {
    expect(closeQuantityForPercentage('33.5', 50, '0.1')).toBe('16.7');
    expect(closeQuantityForPercentage('-250', 25, '1')).toBe('62');
  });

  it('returns zero when the percentage cannot produce a valid lot', () => {
    expect(closeQuantityForPercentage('1', 0, '1')).toBe('0');
    expect(closeQuantityForPercentage('1', 50, '1')).toBe('0');
  });
});
