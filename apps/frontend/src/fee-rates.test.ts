import { describe, expect, it } from 'vitest';
import { effectiveFutureFeeRate, numericFutureFeeRate } from './fee-rates.js';

describe('effective CrossEx future fees', () => {
  const fees = [{
    venue: 'BINANCE',
    spotMakerFee: '0.001',
    spotTakerFee: '0.001',
    futureMakerFee: '0.0001',
    futureTakerFee: '0.0004',
    specialFees: [{ symbol: 'BINANCE_FUTURE_BTC_USDT', makerFee: '0.00001', takerFee: '0.00002' }],
  }];

  it('prefers an exact symbol override', () => {
    expect(effectiveFutureFeeRate(fees, 'binance', 'binance_future_btc_usdt')).toEqual({
      makerFee: '0.00001', takerFee: '0.00002', source: 'symbol',
    });
    expect(numericFutureFeeRate(fees, 'BINANCE', 'BINANCE_FUTURE_BTC_USDT', 'taker')).toBe(0.00002);
  });

  it('falls back to the venue default for other symbols', () => {
    expect(effectiveFutureFeeRate(fees, 'BINANCE', 'BINANCE_FUTURE_ETH_USDT')).toEqual({
      makerFee: '0.0001', takerFee: '0.0004', source: 'venue',
    });
  });
});
