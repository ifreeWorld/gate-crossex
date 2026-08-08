import { describe, expect, it } from 'vitest';
import type { MarketSnapshot } from './api.js';
import {
  estimatedPositionFunding,
  fundingEstimateText,
  fundingRateText,
  livePositionFunding,
} from './position-live-funding.js';

const now = Date.parse('2026-08-07T04:00:00.000Z');

function snapshot(overrides: Partial<MarketSnapshot['markets'][number]> = {}): MarketSnapshot {
  return {
    connectionState: 'healthy',
    updatedAt: new Date(now).toISOString(),
    markets: [{
      symbol: 'BINANCE_FUTURE_SKHY_USDT', venue: 'BINANCE', asset: 'SKHY', lastPrice: '140.05',
      bidPrice: '140', bidSize: '1', askPrice: '140.1', askSize: '1', open24h: '139',
      high24h: '141', low24h: '138', volume24h: '100', quoteVolume24h: '14000',
      fundingRate: '0.0001', nextFundingAt: '2026-08-07T08:00:00.000Z', openInterest: '1',
      openInterestValue: '140', updatedAt: new Date(now - 1_000).toISOString(),
      source: 'gate_crossex_websocket', ...overrides,
    }],
  };
}

describe('live position funding', () => {
  it('returns current WebSocket funding data and formats the percentage', () => {
    expect(livePositionFunding(snapshot(), 'BINANCE_FUTURE_SKHY_USDT', now)).toEqual({
      rate: 0.0001,
      nextFundingAt: '2026-08-07T08:00:00.000Z',
    });
    expect(fundingRateText(0.0001)).toBe('+0.0100%');
    expect(fundingRateText(-0.000015)).toBe('-0.0015%');
  });

  it('rejects seed and stale market values', () => {
    expect(livePositionFunding(snapshot({ source: 'demo_seed' }), 'BINANCE_FUTURE_SKHY_USDT', now)).toBeNull();
    expect(livePositionFunding(snapshot({ updatedAt: new Date(now - 60_001).toISOString() }), 'BINANCE_FUTURE_SKHY_USDT', now)).toBeNull();
  });

  it('estimates whether the next funding settlement is paid or received', () => {
    expect(estimatedPositionFunding(2, 100, 0.0001)).toBeCloseTo(-0.02);
    expect(estimatedPositionFunding(-2, 100, 0.0001)).toBeCloseTo(0.02);
    expect(estimatedPositionFunding(2, 100, -0.0001)).toBeCloseTo(0.02);
    expect(estimatedPositionFunding(-2, 100, -0.0001)).toBeCloseTo(-0.02);
    expect(estimatedPositionFunding(0, 100, 0.0001)).toBeNull();
  });

  it('formats an explanatory hover label', () => {
    expect(fundingEstimateText(-0.02, 'USDT', 'Estimated increase', 'Estimated deduction', 'Longs pay shorts', 'Estimate note'))
      .toBe('Estimated deduction 0.0200 USDT\nLongs pay shorts\nEstimate note');
  });
});
