import { Decimal } from 'decimal.js';
import type {
  SkHynixArbitrageCapabilities,
  SkHynixArbitrageOpportunitiesResponse,
  SkHynixArbitrageOpportunityQuery,
  SkHynixArbitragePositionsResponse,
  SkHynixArbitragePreview,
  SkHynixArbitragePreviewRequest,
  SkHynixArbitrageSpec,
} from '@gate-crossex/shared-types';

const FIXTURE_AT = '2026-08-09T08:00:00.000Z';
const SPEC_VERSION = 'fixture-2026-08-09';
const EQUITY_PRICE = new Decimal('124.62');
const EQUITY_BID = new Decimal('124.48');
const FUNDING_INTERVAL_SECONDS = 28_800;
const perps = [
  { venue: 'OKX', symbol: 'OKX_FUTURE_SKHYNIX_USDT', bid: '124.93', ask: '125.08', funding: '0.001849', costsBps: '23', latencyMs: 61 },
  { venue: 'BYBIT', symbol: 'BYBIT_FUTURE_SKHYNIX_USDT', bid: '124.88', ask: '125.02', funding: '0.00145', costsBps: '23', latencyMs: 68 },
  { venue: 'GATE', symbol: 'GATE_FUTURE_SKHYNIX_USDT', bid: '124.84', ask: '125.01', funding: '0.00110', costsBps: '23', latencyMs: 74 },
  { venue: 'BINANCE', symbol: 'BINANCE_FUTURE_SKHYNIX_USDT', bid: '124.79', ask: '124.95', funding: '0.00082', costsBps: '23', latencyMs: 57 },
] as const;

export function skHynixArbitrageCapabilities(): SkHynixArbitrageCapabilities {
  return {
    phase: 'READ_ONLY_FIXTURE', liveExecutionEnabled: false, simulationEnabled: false,
    ibkr: { connectionState: 'FIXTURE', marketDataType: 'DELAYED', lastEventAt: FIXTURE_AT },
    perp: { connectionState: 'FIXTURE', lastEventAt: FIXTURE_AT },
    fx: { connectionState: 'FIXTURE', lastEventAt: FIXTURE_AT },
    recovery: { state: 'READY', unresolvedBatchCount: 0 },
  };
}

export function skHynixArbitrageSpec(): SkHynixArbitrageSpec {
  return {
    version: SPEC_VERSION, source: 'FIXTURE', status: 'SUSPENDED', verifiedAt: null,
    equity: { broker: 'IBKR', conId: null, localSymbol: '000660', secType: 'STK', exchange: 'KRX', currency: 'KRW', lotSize: '1' },
    approvedPerps: perps.map((perp) => ({ venue: perp.venue, symbol: perp.symbol, settlementCurrency: 'USDT', contractMultiplier: '1', quantityStep: '0.001', minimumQuantity: '0.001', equityUnitsPerPerpUnit: '1' })),
  };
}

export function querySkHynixArbitrageOpportunities(input: SkHynixArbitrageOpportunityQuery): SkHynixArbitrageOpportunitiesResponse {
  const equityQuantity = Decimal.max(0, new Decimal(input.requestedNotional).div(EQUITY_PRICE).floor());
  const residual = new Decimal(input.requestedNotional).minus(equityQuantity.mul(EQUITY_PRICE));
  return {
    sequence: 1, calculatedAt: FIXTURE_AT,
    opportunities: perps.map((perp) => {
      const perpPrice = new Decimal(perp.bid);
      const spread = perpPrice.div(EQUITY_PRICE).minus(1).mul(10_000);
      const expectedFundingBps = new Decimal(perp.funding)
        .mul(new Decimal(input.horizonSeconds).div(FUNDING_INTERVAL_SECONDS))
        .mul(10_000);
      const expectedNetReturnBps = spread.plus(expectedFundingBps).minus(perp.costsBps);
      return {
        specVersion: SPEC_VERSION, perpVenue: perp.venue, perpSymbol: perp.symbol,
        eligible: false, ineligibilityReasons: ['FIXTURE_DATA'], requestedNotional: input.requestedNotional,
        reportCurrency: 'USDT', horizonSeconds: input.horizonSeconds, equityQuantity: equityQuantity.toFixed(0), perpQuantity: equityQuantity.toFixed(3),
        equityVwap: EQUITY_PRICE.toFixed(2), perpVwap: perp.bid,
        equityQuote: { bidKrw: '173005', askKrw: '173200', bidUsdt: EQUITY_BID.toFixed(2), askUsdt: EQUITY_PRICE.toFixed(2), latencyMs: 82 },
        perpQuote: { bid: perp.bid, ask: perp.ask, latencyMs: perp.latencyMs },
        fx: { usdKrw: '1389.83', usdtUsd: '0.9998', latencyMs: 54 },
        openingSpreadBps: spread.toFixed(2), expectedFundingBps: expectedFundingBps.toFixed(2), expectedExitBasisBps: '0', estimatedCostsBps: perp.costsBps,
        expectedNetReturnBps: expectedNetReturnBps.toFixed(2), expectedNetReturnAmount: new Decimal(input.requestedNotional).mul(expectedNetReturnBps).div(10_000).toFixed(2),
        residualEconomicExposure: residual.toFixed(2), residualFxExposure: equityQuantity.mul(EQUITY_PRICE).toFixed(2),
        funding: { rate: perp.funding, intervalSeconds: FUNDING_INTERVAL_SECONDS, nextFundingAt: '2026-08-10T16:00:00.000Z', predictionSource: 'FIXTURE_CURRENT_RATE' },
        quoteTimestamps: { ibkr: FIXTURE_AT, perp: FIXTURE_AT, fx: FIXTURE_AT },
        assumptions: ['示例数据', '资金费按当前费率外推', '预计平仓价差为 0 bps'],
      };
    }),
  };
}

export function skHynixArbitragePositions(): SkHynixArbitragePositionsResponse {
  return { fetchedAt: FIXTURE_AT, items: [{
    id: 'skha-pos-01', specVersion: SPEC_VERSION, state: 'OPEN', perpVenue: 'OKX', perpSymbol: 'OKX_FUTURE_SKHYNIX_USDT',
    remainingEquityQuantity: '8', remainingPerpQuantity: '8', equityAverageEntryPrice: '124.62', perpAverageEntryPrice: '124.93',
    fundingCashflow: '4.62', fundingAttributionState: 'VERIFIED', commissionsAndFees: '0.39', netPnl: '2.25', residualEconomicExposure: '0.10',
    rowVersion: 7, openedAt: '2026-08-08T13:18:42.000Z', updatedAt: FIXTURE_AT,
  }] };
}

export function previewSkHynixArbitrage(input: SkHynixArbitragePreviewRequest): SkHynixArbitragePreview {
  if (input.mode === 'OPEN') {
    const opportunity = querySkHynixArbitrageOpportunities(input).opportunities.find((item) => item.perpVenue === input.perpVenue && item.perpSymbol === input.perpSymbol);
    if (!opportunity) throw new Error('sk_hynix_arbitrage_perp_not_approved');
    return {
      previewId: 'skha-preview-open', source: 'FIXTURE', mode: 'OPEN', specVersion: SPEC_VERSION, positionId: null, positionVersion: null,
      expiresAt: '2026-08-09T08:00:02.000Z', eligible: false, ineligibilityReasons: ['FIXTURE_DATA'],
      orders: {
        equity: { adapter: 'IBKR', instrument: '000660', side: 'BUY', quantity: opportunity.equityQuantity, vwap: opportunity.equityVwap, reduceOnly: false },
        perp: { adapter: 'CROSSEX', instrument: opportunity.perpSymbol, side: 'SELL', quantity: opportunity.perpQuantity, vwap: opportunity.perpVwap, reduceOnly: false },
      },
      remaining: { equityQuantity: opportunity.equityQuantity, perpQuantity: opportunity.perpQuantity, netEconomicExposure: opportunity.residualEconomicExposure },
      expectedNetReturnAmount: opportunity.expectedNetReturnAmount, expectedNetReturnBps: opportunity.expectedNetReturnBps, assumptions: opportunity.assumptions,
    };
  }
  const position = skHynixArbitragePositions().items.find((item) => item.id === input.positionId);
  if (!position) throw new Error('sk_hynix_arbitrage_position_not_found');
  if (position.rowVersion !== input.expectedPositionVersion) throw new Error('sk_hynix_arbitrage_position_changed');
  const fraction = new Decimal(input.closeFraction);
  const equity = new Decimal(position.remainingEquityQuantity).mul(fraction).floor();
  const perp = new Decimal(position.remainingPerpQuantity).mul(fraction);
  return {
    previewId: 'skha-preview-close', source: 'FIXTURE', mode: 'CLOSE', specVersion: position.specVersion, positionId: position.id, positionVersion: position.rowVersion,
    expiresAt: '2026-08-09T08:00:02.000Z', eligible: false, ineligibilityReasons: ['FIXTURE_DATA'],
    orders: {
      equity: { adapter: 'IBKR', instrument: '000660', side: 'SELL', quantity: equity.toFixed(0), vwap: '124.48', reduceOnly: false },
      perp: { adapter: 'CROSSEX', instrument: position.perpSymbol, side: 'BUY', quantity: perp.toFixed(3).replace(/\.000$/, ''), vwap: '125.08', reduceOnly: true },
    },
    remaining: {
      equityQuantity: new Decimal(position.remainingEquityQuantity).minus(equity).toFixed(0),
      perpQuantity: new Decimal(position.remainingPerpQuantity).minus(perp).toFixed(3).replace(/\.000$/, ''), netEconomicExposure: '0.05',
    },
    expectedNetReturnAmount: '0.50', expectedNetReturnBps: '5.00', assumptions: ['示例数据', 'Reduce-only 永续平仓'],
  };
}
