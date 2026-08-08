import { describe, expect, it } from 'vitest';
import type { PortfolioFuturesPosition } from '@gate-crossex/shared-types';
import {
  aggregatePositionFundingFee,
  aggregatePositionTradingFee,
  netPositionPnl,
  pnlIncludingSettledFunding,
  positionFundingFee,
  positionTradingFee,
} from './position-funding-fees.js';

function portfolioPosition(
  positionId: string,
  symbol: string,
  fundingFee: string,
  fee = '0',
): PortfolioFuturesPosition {
  return {
    positionId, symbol, fundingFee, positionSide: 'LONG', initialMargin: '0', maintenanceMargin: '0',
    quantity: '1', value: '1', unrealizedPnl: '0', unrealizedPnlRate: '0', entryPrice: '1', markPrice: '1',
    leverage: '1', maxLeverage: '1', riskLimit: '0', fee, fundingTime: '0', createdAt: '', updatedAt: '',
    realizedPnl: '0',
  };
}

describe('position funding fees', () => {
  it('adds settled funding to price PnL without adding an unavailable value', () => {
    expect(pnlIncludingSettledFunding(-1.5, 0.4)).toBeCloseTo(-1.1);
    expect(pnlIncludingSettledFunding(2, -0.25)).toBeCloseTo(1.75);
    expect(pnlIncludingSettledFunding(2, null)).toBe(2);
  });

  it('subtracts charged position fees while preserving negative maker rebates', () => {
    expect(netPositionPnl(10, -1.5, 0.2)).toBeCloseTo(8.3);
    expect(netPositionPnl(10, 0.5, -0.1)).toBeCloseTo(10.6);
    expect(netPositionPnl(10, null, null)).toBe(10);
  });

  it('matches by position id before symbol and sums complete venue legs', () => {
    const sources = [
      portfolioPosition('long-1', 'BINANCE_FUTURE_BTC_USDT', '1.25'),
      portfolioPosition('short-1', 'BINANCE_FUTURE_BTC_USDT', '-0.4'),
      portfolioPosition('gate-1', 'GATE_FUTURE_BTC_USDT', '0.2'),
    ];
    expect(positionFundingFee({ position_id: 'short-1', symbol: 'BINANCE_FUTURE_BTC_USDT' }, sources)).toBe(-0.4);
    expect(aggregatePositionFundingFee([
      { position_id: 'long-1', symbol: 'BINANCE_FUTURE_BTC_USDT' },
      { position_id: 'gate-1', symbol: 'GATE_FUTURE_BTC_USDT' },
    ], sources)).toBe(1.45);
  });

  it('sums the funding fees carried by refreshed execution positions without a portfolio snapshot', () => {
    expect(aggregatePositionFundingFee([
      { position_id: 'hyperliquid-1', symbol: 'HYPERLIQUID_FUTURE_HYPE_USDC', funding_fee: '1.2345' },
      { position_id: 'bybit-1', symbol: 'BYBIT_FUTURE_HYPE_USDT', funding_fee: '-0.2345' },
    ], [])).toBe(1);
  });

  it('uses a unique symbol fallback but never guesses between dual-side positions', () => {
    const unique = [portfolioPosition('remote-1', 'GATE_FUTURE_ETH_USDT', '0.003')];
    expect(positionFundingFee({ position_id: 'local-1', symbol: 'GATE_FUTURE_ETH_USDT' }, unique)).toBe(0.003);

    const ambiguous = [
      portfolioPosition('long-1', 'OKX_FUTURE_ETH_USDT', '0.1'),
      portfolioPosition('short-1', 'OKX_FUTURE_ETH_USDT', '-0.1'),
    ];
    expect(positionFundingFee({ position_id: 'missing', symbol: 'OKX_FUTURE_ETH_USDT' }, ambiguous)).toBeNull();
  });

  it('matches and aggregates the exchange-reported fee for the current open positions', () => {
    const sources = [
      portfolioPosition('left', 'BINANCE_FUTURE_SKHY_USDT', '0', '0.21517057'),
      portfolioPosition('right', 'BINANCE_FUTURE_SKHYNIX_USDT', '0', '0.21443242'),
    ];
    expect(positionTradingFee({ position_id: 'left', symbol: 'BINANCE_FUTURE_SKHY_USDT' }, sources))
      .toBeCloseTo(0.21517057);
    expect(aggregatePositionTradingFee([
      { position_id: 'left', symbol: 'BINANCE_FUTURE_SKHY_USDT' },
      { position_id: 'right', symbol: 'BINANCE_FUTURE_SKHYNIX_USDT' },
    ], sources)).toBeCloseTo(0.42960299);
  });
});
