import { describe, expect, it } from 'vitest';
import type { SkHynixArbitrageOpportunity, SkHynixArbitragePosition } from '@gate-crossex/shared-types';
import { deriveDemoOrder } from './demo-model.js';

const opportunity = {
  specVersion: 'fixture', perpVenue: 'OKX', perpSymbol: 'OKX_FUTURE_SKHYNIX_USDT', eligible: false,
  ineligibilityReasons: ['FIXTURE_DATA'], requestedNotional: '1000', reportCurrency: 'USDT', horizonSeconds: 86400,
  equityQuantity: '8', perpQuantity: '8', equityVwap: '124.62', perpVwap: '124.93', openingSpreadBps: '24.87',
  equityQuote: { bidKrw: '173005', askKrw: '173200', bidUsdt: '124.48', askUsdt: '124.62', latencyMs: 82 },
  perpQuote: { bid: '124.93', ask: '125.08', latencyMs: 61 },
  fx: { usdKrw: '1389.83', usdtUsd: '0.9998', latencyMs: 54 },
  expectedFundingBps: '55.47', expectedExitBasisBps: '0', estimatedCostsBps: '23', expectedNetReturnBps: '57.34',
  expectedNetReturnAmount: '5.73', residualEconomicExposure: '3.04', residualFxExposure: '996.96',
  funding: { rate: '0.001849', intervalSeconds: 28800, nextFundingAt: '2026-08-10T16:00:00.000Z', predictionSource: 'FIXTURE_CURRENT_RATE' },
  quoteTimestamps: { ibkr: '2026-08-10T08:00:00.000Z', perp: '2026-08-10T08:00:00.000Z', fx: '2026-08-10T08:00:00.000Z' }, assumptions: ['fixture'],
} satisfies SkHynixArbitrageOpportunity;

const position = {
  id: 'skha-pos-01', specVersion: 'fixture', state: 'OPEN', perpVenue: 'OKX', perpSymbol: opportunity.perpSymbol,
  remainingEquityQuantity: '8', remainingPerpQuantity: '8', equityAverageEntryPrice: '124.62', perpAverageEntryPrice: '124.93',
  fundingCashflow: '4.62', fundingAttributionState: 'VERIFIED', commissionsAndFees: '0.39', netPnl: '2.25', residualEconomicExposure: '0.10',
  rowVersion: 7, openedAt: '2026-08-08T13:18:42.000Z', updatedAt: '2026-08-10T08:00:00.000Z',
} satisfies SkHynixArbitragePosition;

describe('SK Hynix Demo calculations', () => {
  it('derives the Demo open order from executable quotes', () => {
    expect(deriveDemoOrder({ mode: 'OPEN', opportunity, requestedNotional: '1000', position: null, closeShares: null })).toMatchObject({
      equityShares: 8, perpQuantity: '8.000', equitySide: 'BUY', perpSide: 'SELL', reduceOnly: false,
      equityNotionalUsdt: '996.96', perpNotionalUsdt: '999.44', mismatchUsdt: '2.48', expectedNetReturnAmount: '5.72',
    });
  });

  it('uses executable exit prices and integer shares for partial close', () => {
    expect(deriveDemoOrder({ mode: 'CLOSE', opportunity, requestedNotional: '1000', position, closeShares: 4 })).toMatchObject({
      equityShares: 4, perpQuantity: '4.000', equitySide: 'SELL', perpSide: 'BUY', reduceOnly: true,
      remainingEquityShares: 4, remainingPerpQuantity: '4.000', executableSpreadBps: '-47.97',
    });
  });
});
