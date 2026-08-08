import { describe, expect, it } from 'vitest';
import { comparePositionDisplayOrder } from './position-display-order.js';

describe('position display order', () => {
  it('keeps longs before shorts and uses the symbol as a stable tie-breaker', () => {
    const rows = [
      { symbol: 'Z-SHORT', quantity: -1 },
      { symbol: 'Z-LONG', quantity: 1 },
      { symbol: 'A-SHORT', quantity: -1 },
      { symbol: 'A-LONG', quantity: 1 },
    ].sort(comparePositionDisplayOrder);

    expect(rows.map((row) => row.symbol)).toEqual(['A-LONG', 'Z-LONG', 'A-SHORT', 'Z-SHORT']);
  });

  it('prefers an explicit position side when an exchange reports unsigned quantities', () => {
    const rows = [
      { symbol: 'SKHY', quantity: 3.2, side: 'Short' },
      { symbol: 'SKHYNIX', quantity: 0.44, side: 'Long' },
    ].sort(comparePositionDisplayOrder);

    expect(rows.map((row) => row.symbol)).toEqual(['SKHYNIX', 'SKHY']);
  });
});
