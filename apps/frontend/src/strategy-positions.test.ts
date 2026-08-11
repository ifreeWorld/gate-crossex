import { describe, expect, it } from 'vitest';
import type { AuthenticatedPortfolioSnapshot, TradingSnapshot } from './api.js';
import { groupStrategyPositions, prepareStrategyPositions, type StrategyPositionRow } from './strategy-positions.js';

function portfolio(
  overrides: Partial<AuthenticatedPortfolioSnapshot> = {},
): AuthenticatedPortfolioSnapshot {
  return {
    dataStatus: 'fresh',
    remoteStatus: 'healthy',
    snapshot: {
      account: {
        availableMargin: '0', marginBalance: '0', initialMargin: '0', maintenanceMargin: '0',
        initialMarginRate: '0', maintenanceMarginRate: '0', positionMode: '', accountMode: '',
        exchangeType: '', remoteUpdatedAt: '2026-07-31T00:00:00.000Z',
      },
      balances: [],
      futuresPositions: [],
      marginPositions: [],
      openOrders: [],
      recentFills: [],
      fetchedAt: '2026-07-31T00:00:00.000Z',
      source: 'gate_crossex_authenticated_rest',
    },
    reconciliation: {
      id: 'reconciliation', createdAt: '2026-07-31T00:00:00.000Z', status: 'clean',
      previousFetchedAt: null, currentFetchedAt: '2026-07-31T00:00:00.000Z', issues: [],
    },
    ...overrides,
  };
}

function tradingSnapshot(positions: TradingSnapshot['positions']): TradingSnapshot {
  return { mode: 'live', positions, orders: [], fills: [], balances: [] };
}

describe('strategy positions', () => {
  it('does not return rows from an unavailable or stale account snapshot', () => {
    expect(prepareStrategyPositions(null)).toEqual({ status: 'unavailable', rows: [] });
    expect(prepareStrategyPositions(portfolio({ dataStatus: 'stale' }))).toEqual({ status: 'stale', rows: [] });
    expect(prepareStrategyPositions(portfolio({ remoteStatus: 'unavailable' }))).toEqual({ status: 'stale', rows: [] });
  });

  it('maps non-zero fresh futures positions and keeps longs before shorts', () => {
    const snapshot = portfolio();
    snapshot.snapshot.futuresPositions = [
      {
        positionId: 'small', symbol: 'GATE_FUTURE_SKHYNIX_USDT', positionSide: 'SHORT',
        initialMargin: '0', maintenanceMargin: '0', quantity: '-1.3', value: '4546.7',
        unrealizedPnl: '-4.2', unrealizedPnlRate: '0', entryPrice: '1185', markPrice: '1189.77',
        leverage: '3', maxLeverage: '20', riskLimit: '0', fee: '0', fundingFee: '0', fundingTime: '',
        createdAt: '', updatedAt: '', realizedPnl: '0',
      },
      {
        positionId: 'large', symbol: 'BINANCE_FUTURE_SKHY_USDT', positionSide: 'LONG',
        initialMargin: '0', maintenanceMargin: '0', quantity: '20', value: '3187.6',
        unrealizedPnl: '12.5', unrealizedPnlRate: '0', entryPrice: '158', markPrice: '159.38',
        leverage: '5', maxLeverage: '20', riskLimit: '0', fee: '0', fundingFee: '0', fundingTime: '',
        createdAt: '', updatedAt: '', realizedPnl: '0',
      },
      {
        positionId: 'flat', symbol: 'OKX_FUTURE_BTC_USDT', positionSide: 'LONG',
        initialMargin: '0', maintenanceMargin: '0', quantity: '0', value: '0',
        unrealizedPnl: '0', unrealizedPnlRate: '0', entryPrice: '0', markPrice: '0', leverage: '',
        maxLeverage: '20', riskLimit: '0', fee: '0', fundingFee: '0', fundingTime: '',
        createdAt: '', updatedAt: '', realizedPnl: '0',
      },
    ];

    expect(prepareStrategyPositions(snapshot)).toEqual({
      status: 'fresh',
      rows: [
        expect.objectContaining({ id: 'BINANCE:large', asset: 'SKHY', side: 'Long', value: 3187.6 }),
        expect.objectContaining({ id: 'GATE:small', asset: 'SKHYNIX', side: 'Short', value: 4546.7 }),
      ],
    });
  });

  it('shows the execution positions used by the trading page when the portfolio snapshot is empty', () => {
    const snapshot = tradingSnapshot([
      {
        position_id: 'bybit-hype', symbol: 'BYBIT_FUTURE_HYPE_USDT', venue: 'BYBIT',
        quantity: '100', entry_price: '51.7998', mark_price: '51.768', realized_pnl: '0',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
      {
        position_id: 'deribit-hype', symbol: 'DERIBIT_FUTURE_HYPE_USDC', venue: 'DERIBIT',
        quantity: '-100', entry_price: '51.8383', mark_price: '51.818', realized_pnl: '0',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ]);

    expect(prepareStrategyPositions(portfolio(), snapshot)).toEqual({
      status: 'fresh',
      rows: [
        expect.objectContaining({ id: 'BYBIT:bybit-hype', asset: 'HYPE', quote: 'USDT', side: 'Long', quantity: 100 }),
        expect.objectContaining({ id: 'DERIBIT:deribit-hype', asset: 'HYPE', quote: 'USDC', side: 'Short', quantity: -100 }),
      ],
    });
  });

  it('calculates PnL from the latest execution mark price instead of stale portfolio PnL', () => {
    const account = portfolio();
    account.snapshot.futuresPositions = [{
      positionId: 'skhy', symbol: 'BINANCE_FUTURE_SKHY_USDT', positionSide: 'SHORT',
      initialMargin: '0', maintenanceMargin: '0', quantity: '-3.2', value: '448',
      unrealizedPnl: '99', unrealizedPnlRate: '0', entryPrice: '140.085', markPrice: '100',
      leverage: '5', maxLeverage: '25', riskLimit: '1', fee: '0.2', fundingFee: '0.5', fundingTime: '',
      createdAt: '', updatedAt: '2026-08-07T02:44:32.389Z', realizedPnl: '0',
    }];
    const snapshot = tradingSnapshot([{
      position_id: 'skhy', symbol: 'BINANCE_FUTURE_SKHY_USDT', venue: 'BINANCE',
      quantity: '-3.2', entry_price: '140.085', mark_price: '140.09', realized_pnl: '0',
      updated_at: '2026-08-07T02:47:20.241Z',
    }]);

    expect(prepareStrategyPositions(account, snapshot)).toEqual({
      status: 'fresh',
      rows: [expect.objectContaining({
        id: 'BINANCE:skhy', markPrice: 140.09, leverage: '5', unrealizedPnl: closeTo(-0.016),
        fundingFee: 0.5, tradingFee: 0.2, netPnl: closeTo(0.284),
      })],
    });
  });

  it('groups same-asset venue legs with the aggregate values used by the trading page', () => {
    const row = (overrides: Partial<StrategyPositionRow>): StrategyPositionRow => ({
      id: 'row', symbol: 'BYBIT_FUTURE_HYPE_USDT', venue: 'BYBIT', asset: 'HYPE', quote: 'USDT', side: 'Long', quantity: 100,
      value: 5_200, entryPrice: 51, markPrice: 52, leverage: '5', unrealizedPnl: 100,
      netPnl: 100, fundingFee: null, tradingFee: null,
      ...overrides,
    });

    expect(groupStrategyPositions([
      row({ id: 'long', venue: 'BYBIT' }),
      row({ id: 'short', venue: 'DERIBIT', quote: 'USDC', side: 'Short', quantity: -100, value: 5_100, entryPrice: 52, markPrice: 51, unrealizedPnl: 100 }),
    ])).toEqual([expect.objectContaining({
      key: 'HYPE-PERP', quantity: 0, grossQuantity: 200, grossNotional: 10_300,
      weightedEntryPrice: 51.5, weightedMarkPrice: 51.5, unrealizedPnl: 200,
      venueCount: 2, fullyHedged: true, leverage: '5',
    })]);
  });

  it('groups SKHY and SKHYNIX as one expandable premium pair', () => {
    const rows: StrategyPositionRow[] = [
      { id: 'adr', symbol: 'GATE_FUTURE_SKHY_USDT', venue: 'GATE', asset: 'SKHY', quote: 'USDT', side: 'Short', quantity: -1, value: 230, entryPrice: 230, markPrice: 229, leverage: '5', unrealizedPnl: 1, netPnl: 1, fundingFee: null, tradingFee: null },
      { id: 'local', symbol: 'BINANCE_FUTURE_SKHYNIX_USDT', venue: 'BINANCE', asset: 'SKHYNIX', quote: 'USDT', side: 'Long', quantity: 0.1, value: 170, entryPrice: 1700, markPrice: 1710, leverage: '5', unrealizedPnl: 1, netPnl: 1, fundingFee: null, tradingFee: null },
    ];

    expect(groupStrategyPositions(rows)).toEqual([expect.objectContaining({
      key: 'SKHY-SKHYNIX-PERP', label: 'SKHY / SKHYNIX', mixedAssets: true,
      legs: rows, grossNotional: 400, unrealizedPnl: 2, fullyHedged: true,
    })]);
  });
});

function closeTo(expected: number) {
  return expect.closeTo(expected, 10);
}
