import { describe, expect, it } from 'vitest';
import {
  SkHynixArbitrageCapabilitiesSchema,
  SkHynixArbitrageOpportunityQuerySchema,
  SkHynixArbitrageOpportunitiesResponseSchema,
  SkHynixArbitragePreviewSchema,
  SkHynixArbitrageSpecSchema,
} from './sk-hynix-arbitrage.js';

const timestamp = '2026-08-09T08:00:00.000Z';

describe('SK Hynix arbitrage contracts', () => {
  it('accepts only the fixed read-only capability contract', () => {
    expect(SkHynixArbitrageCapabilitiesSchema.parse({
      phase: 'READ_ONLY_FIXTURE', liveExecutionEnabled: false, simulationEnabled: false,
      ibkr: { connectionState: 'FIXTURE', marketDataType: 'DELAYED', lastEventAt: timestamp },
      perp: { connectionState: 'FIXTURE', lastEventAt: timestamp },
      fx: { connectionState: 'FIXTURE', lastEventAt: timestamp },
      recovery: { state: 'READY', unresolvedBatchCount: 0 },
    }).phase).toBe('READ_ONLY_FIXTURE');
    expect(() => SkHynixArbitrageCapabilitiesSchema.parse({
      phase: 'LIVE_READY', liveExecutionEnabled: true, simulationEnabled: false,
    })).toThrow();
  });

  it('rejects any equity other than IBKR 000660', () => {
    const spec = {
      version: 'fixture-2026-08-09', source: 'FIXTURE', status: 'SUSPENDED',
      equity: { broker: 'IBKR', conId: null, localSymbol: '000660', secType: 'STK', exchange: 'KRX', currency: 'KRW', lotSize: '1' },
      approvedPerps: [{ venue: 'OKX', symbol: 'OKX_FUTURE_SKHYNIX_USDT', settlementCurrency: 'USDT', contractMultiplier: '1', quantityStep: '0.001', minimumQuantity: '0.001', equityUnitsPerPerpUnit: '1' }],
      verifiedAt: null,
    };
    expect(SkHynixArbitrageSpecSchema.parse(spec).equity.localSymbol).toBe('000660');
    expect(() => SkHynixArbitrageSpecSchema.parse({ ...spec, equity: { ...spec.equity, localSymbol: '005930' } })).toThrow();
  });

  it('keeps opportunity inputs decimal-safe and server-scoped', () => {
    expect(SkHynixArbitrageOpportunityQuerySchema.parse({
      requestedNotional: '1000', reportCurrency: 'USDT', horizonSeconds: 86400, maxSlippageBps: '20',
    })).toEqual({ requestedNotional: '1000', reportCurrency: 'USDT', horizonSeconds: 86400, maxSlippageBps: '20' });
    expect(() => SkHynixArbitrageOpportunityQuerySchema.parse({
      requestedNotional: 1000, reportCurrency: 'USDT', horizonSeconds: 86400, maxSlippageBps: '20', equitySymbol: '005930',
    })).toThrow();
  });

  it('requires fixture opportunities and previews to remain ineligible', () => {
    const opportunity = {
      specVersion: 'fixture-2026-08-09', perpVenue: 'OKX', perpSymbol: 'OKX_FUTURE_SKHYNIX_USDT',
      eligible: false, ineligibilityReasons: ['FIXTURE_DATA'], requestedNotional: '1000', reportCurrency: 'USDT', horizonSeconds: 86400,
      equityQuantity: '8', perpQuantity: '8', equityVwap: '124.62', perpVwap: '124.93', openingSpreadBps: '24.87',
      equityQuote: { bidKrw: '173005', askKrw: '173200', bidUsdt: '124.48', askUsdt: '124.62', latencyMs: 82 },
      perpQuote: { bid: '124.93', ask: '125.08', latencyMs: 61 },
      fx: { usdKrw: '1389.83', usdtUsd: '0.9998', latencyMs: 54 },
      expectedFundingBps: '55.47', expectedExitBasisBps: '0', estimatedCostsBps: '23', expectedNetReturnBps: '57.34',
      expectedNetReturnAmount: '5.73', residualEconomicExposure: '2.48', residualFxExposure: '996.96',
      funding: { rate: '0.001849', intervalSeconds: 28800, nextFundingAt: timestamp, predictionSource: 'FIXTURE_CURRENT_RATE' },
      quoteTimestamps: { ibkr: timestamp, perp: timestamp, fx: timestamp }, assumptions: ['示例数据'],
    };
    expect(SkHynixArbitrageOpportunitiesResponseSchema.parse({ sequence: 1, calculatedAt: timestamp, opportunities: [opportunity] }).opportunities).toHaveLength(1);
    expect(() => SkHynixArbitrageOpportunitiesResponseSchema.parse({ sequence: 1, calculatedAt: timestamp, opportunities: [{ ...opportunity, eligible: true }] })).toThrow();

    const preview = {
      previewId: 'skha-preview-1', source: 'FIXTURE', mode: 'OPEN', specVersion: 'fixture-2026-08-09', positionId: null,
      positionVersion: null, expiresAt: timestamp, eligible: false, ineligibilityReasons: ['FIXTURE_DATA'],
      orders: {
        equity: { adapter: 'IBKR', instrument: '000660', side: 'BUY', quantity: '8', vwap: '124.62', reduceOnly: false },
        perp: { adapter: 'CROSSEX', instrument: 'OKX_FUTURE_SKHYNIX_USDT', side: 'SELL', quantity: '8', vwap: '124.93', reduceOnly: false },
      },
      remaining: { equityQuantity: '8', perpQuantity: '8', netEconomicExposure: '2.48' },
      expectedNetReturnAmount: '5.73', expectedNetReturnBps: '57.34', assumptions: ['示例数据'],
    };
    expect(SkHynixArbitragePreviewSchema.parse(preview).eligible).toBe(false);
    expect(() => SkHynixArbitragePreviewSchema.parse({ ...preview, eligible: true })).toThrow();
  });
});
