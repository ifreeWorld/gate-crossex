import { describe, expect, it } from 'vitest';
import { closeFractionQuantity } from './close-sizing.js';

describe('SK Hynix close sizing', () => {
  it.each([['0.25', '2'], ['0.5', '4'], ['0.75', '6'], ['1', '8']] as const)('closes %s of integer shares', (fraction, expected) => {
    expect(closeFractionQuantity('8', fraction)).toBe(expected);
  });
  it('never rounds above the strategy shares', () => expect(closeFractionQuantity('7', '0.5')).toBe('3'));
});
