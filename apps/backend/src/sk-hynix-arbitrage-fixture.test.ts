import { describe, expect, it } from 'vitest';
import { SkHynixArbitragePreviewSchema } from '@gate-crossex/shared-types';
import {
  previewSkHynixArbitrage,
  querySkHynixArbitrageOpportunities,
  skHynixArbitragePositions,
} from './sk-hynix-arbitrage-fixture.js';

describe('SK Hynix arbitrage fixture', () => {
  it('ranks only approved SKHYNIX perpetuals by expected return', () => {
    const result = querySkHynixArbitrageOpportunities({ requestedNotional: '1000', reportCurrency: 'USDT', horizonSeconds: 86400, maxSlippageBps: '20' });
    expect(result.opportunities.map((item) => item.perpSymbol)).toEqual([
      'OKX_FUTURE_SKHYNIX_USDT', 'BYBIT_FUTURE_SKHYNIX_USDT', 'GATE_FUTURE_SKHYNIX_USDT', 'BINANCE_FUTURE_SKHYNIX_USDT',
    ]);
    expect(result.opportunities.every((item) => !item.eligible && item.ineligibilityReasons.includes('FIXTURE_DATA'))).toBe(true);
    expect(result.opportunities[0]).toMatchObject({
      equityQuote: { bidKrw: '173005', askKrw: '173200', askUsdt: '124.62' },
      perpQuote: { bid: '124.93', ask: '125.08' },
      fx: { usdKrw: '1389.83', usdtUsd: '0.9998' },
    });
  });

  it('recalculates funding and net return for the selected holding horizon', () => {
    const eightHours = querySkHynixArbitrageOpportunities({ requestedNotional: '1000', reportCurrency: 'USDT', horizonSeconds: 28800, maxSlippageBps: '20' }).opportunities[0];
    const sevenDays = querySkHynixArbitrageOpportunities({ requestedNotional: '1000', reportCurrency: 'USDT', horizonSeconds: 604800, maxSlippageBps: '20' }).opportunities[0];
    expect(eightHours).toMatchObject({ expectedFundingBps: '18.49', expectedNetReturnBps: '20.37' });
    expect(sevenDays).toMatchObject({ expectedFundingBps: '388.29', expectedNetReturnBps: '390.17' });
  });

  it('derives partial close quantities from the strategy position', () => {
    const position = skHynixArbitragePositions().items[0];
    expect(position).toBeDefined();
    const preview = previewSkHynixArbitrage({
      mode: 'CLOSE', positionId: position!.id, closeFraction: '0.5', expectedPositionVersion: position!.rowVersion, maxSlippageBps: '20',
    });
    expect(SkHynixArbitragePreviewSchema.parse(preview)).toMatchObject({
      mode: 'CLOSE',
      orders: { equity: { side: 'SELL', quantity: '4' }, perp: { side: 'BUY', quantity: '4', reduceOnly: true } },
      remaining: { equityQuantity: '4', perpQuantity: '4' },
      eligible: false,
    });
  });

  it('rejects unapproved contracts and stale position versions', () => {
    expect(() => previewSkHynixArbitrage({
      mode: 'OPEN', perpVenue: 'FAKE', perpSymbol: 'FAKE_FUTURE_SKHYNIX_USDT', requestedNotional: '1000', reportCurrency: 'USDT', horizonSeconds: 86400, maxSlippageBps: '20',
    })).toThrow('sk_hynix_arbitrage_perp_not_approved');
    expect(() => previewSkHynixArbitrage({
      mode: 'CLOSE', positionId: 'skha-pos-01', closeFraction: '1', expectedPositionVersion: 999, maxSlippageBps: '20',
    })).toThrow('sk_hynix_arbitrage_position_changed');
  });
});
