import { describe, expect, it } from 'vitest';
import { formatSignedBps, formatSignedMoney } from './calculations.js';

describe('SK Hynix display calculations', () => {
  it('formats signed fixture values', () => {
    expect(formatSignedBps('24.87')).toBe('+24.87 bps');
    expect(formatSignedBps('-2')).toBe('-2.00 bps');
    expect(formatSignedMoney('5.73')).toBe('+$5.73');
    expect(formatSignedMoney('-5.73')).toBe('-$5.73');
  });
});
