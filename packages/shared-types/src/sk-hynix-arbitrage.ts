import { z } from 'zod';

const decimalText = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const nonnegativeDecimalText = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const timestamp = z.iso.datetime();

export const SkHynixArbitrageCapabilitiesSchema = z.strictObject({
  phase: z.literal('READ_ONLY_FIXTURE'),
  liveExecutionEnabled: z.literal(false),
  simulationEnabled: z.literal(false),
  ibkr: z.strictObject({
    connectionState: z.literal('FIXTURE'),
    marketDataType: z.literal('DELAYED'),
    lastEventAt: timestamp,
  }),
  perp: z.strictObject({ connectionState: z.literal('FIXTURE'), lastEventAt: timestamp }),
  fx: z.strictObject({ connectionState: z.literal('FIXTURE'), lastEventAt: timestamp }),
  recovery: z.strictObject({ state: z.literal('READY'), unresolvedBatchCount: z.literal(0) }),
});
export type SkHynixArbitrageCapabilities = z.infer<typeof SkHynixArbitrageCapabilitiesSchema>;

export const SkHynixArbitrageSpecSchema = z.strictObject({
  version: z.string().min(1),
  source: z.literal('FIXTURE'),
  status: z.literal('SUSPENDED'),
  equity: z.strictObject({
    broker: z.literal('IBKR'),
    conId: z.number().int().positive().nullable(),
    localSymbol: z.literal('000660'),
    secType: z.literal('STK'),
    exchange: z.literal('KRX'),
    currency: z.literal('KRW'),
    lotSize: nonnegativeDecimalText,
  }),
  approvedPerps: z.array(z.strictObject({
    venue: z.string().min(1),
    symbol: z.string().regex(/^[A-Z0-9]+_FUTURE_SKHYNIX_(?:USDT|USDC|USD)$/),
    settlementCurrency: z.enum(['USDT', 'USDC', 'USD']),
    contractMultiplier: nonnegativeDecimalText,
    quantityStep: nonnegativeDecimalText,
    minimumQuantity: nonnegativeDecimalText,
    equityUnitsPerPerpUnit: nonnegativeDecimalText,
  })).min(1),
  verifiedAt: timestamp.nullable(),
});
export type SkHynixArbitrageSpec = z.infer<typeof SkHynixArbitrageSpecSchema>;

export const SkHynixArbitrageOpportunityQuerySchema = z.strictObject({
  requestedNotional: nonnegativeDecimalText,
  reportCurrency: z.literal('USDT'),
  horizonSeconds: z.number().int().min(3600).max(30 * 24 * 60 * 60),
  maxSlippageBps: nonnegativeDecimalText,
});
export type SkHynixArbitrageOpportunityQuery = z.infer<typeof SkHynixArbitrageOpportunityQuerySchema>;

export const SkHynixArbitrageOpportunitySchema = z.strictObject({
  specVersion: z.string(),
  perpVenue: z.string(),
  perpSymbol: z.string(),
  eligible: z.literal(false),
  ineligibilityReasons: z.array(z.string()).min(1),
  requestedNotional: nonnegativeDecimalText,
  reportCurrency: z.literal('USDT'),
  horizonSeconds: z.number().int().positive(),
  equityQuantity: nonnegativeDecimalText,
  perpQuantity: nonnegativeDecimalText,
  equityVwap: nonnegativeDecimalText,
  perpVwap: nonnegativeDecimalText,
  equityQuote: z.strictObject({
    bidKrw: nonnegativeDecimalText,
    askKrw: nonnegativeDecimalText,
    bidUsdt: nonnegativeDecimalText,
    askUsdt: nonnegativeDecimalText,
    latencyMs: z.number().int().nonnegative(),
  }),
  perpQuote: z.strictObject({
    bid: nonnegativeDecimalText,
    ask: nonnegativeDecimalText,
    latencyMs: z.number().int().nonnegative(),
  }),
  fx: z.strictObject({
    usdKrw: nonnegativeDecimalText,
    usdtUsd: nonnegativeDecimalText,
    latencyMs: z.number().int().nonnegative(),
  }),
  openingSpreadBps: decimalText,
  expectedFundingBps: decimalText,
  expectedExitBasisBps: decimalText,
  estimatedCostsBps: nonnegativeDecimalText,
  expectedNetReturnBps: decimalText,
  expectedNetReturnAmount: decimalText,
  residualEconomicExposure: decimalText,
  residualFxExposure: decimalText,
  funding: z.strictObject({
    rate: decimalText,
    intervalSeconds: z.number().int().positive(),
    nextFundingAt: timestamp,
    predictionSource: z.literal('FIXTURE_CURRENT_RATE'),
  }),
  quoteTimestamps: z.strictObject({ ibkr: timestamp, perp: timestamp, fx: timestamp }),
  assumptions: z.array(z.string()),
});
export type SkHynixArbitrageOpportunity = z.infer<typeof SkHynixArbitrageOpportunitySchema>;

export const SkHynixArbitrageOpportunitiesResponseSchema = z.strictObject({
  sequence: z.number().int().nonnegative(),
  calculatedAt: timestamp,
  opportunities: z.array(SkHynixArbitrageOpportunitySchema),
});
export type SkHynixArbitrageOpportunitiesResponse = z.infer<typeof SkHynixArbitrageOpportunitiesResponseSchema>;

export const SkHynixArbitragePreviewRequestSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('OPEN'),
    perpVenue: z.string().min(1),
    perpSymbol: z.string().min(1),
    requestedNotional: nonnegativeDecimalText,
    reportCurrency: z.literal('USDT'),
    horizonSeconds: z.number().int().min(3600).max(30 * 24 * 60 * 60),
    maxSlippageBps: nonnegativeDecimalText,
  }),
  z.strictObject({
    mode: z.literal('CLOSE'),
    positionId: z.string().min(1),
    closeFraction: z.enum(['0.25', '0.5', '0.75', '1']),
    expectedPositionVersion: z.number().int().positive(),
    maxSlippageBps: nonnegativeDecimalText,
  }),
]);
export type SkHynixArbitragePreviewRequest = z.infer<typeof SkHynixArbitragePreviewRequestSchema>;

const previewOrder = z.strictObject({
  adapter: z.enum(['IBKR', 'CROSSEX']),
  instrument: z.string(),
  side: z.enum(['BUY', 'SELL']),
  quantity: nonnegativeDecimalText,
  vwap: nonnegativeDecimalText,
  reduceOnly: z.boolean(),
});

export const SkHynixArbitragePreviewSchema = z.strictObject({
  previewId: z.string(),
  source: z.literal('FIXTURE'),
  mode: z.enum(['OPEN', 'CLOSE']),
  specVersion: z.string(),
  positionId: z.string().nullable(),
  positionVersion: z.number().int().positive().nullable(),
  expiresAt: timestamp,
  eligible: z.literal(false),
  ineligibilityReasons: z.array(z.string()).min(1),
  orders: z.strictObject({ equity: previewOrder, perp: previewOrder }),
  remaining: z.strictObject({
    equityQuantity: nonnegativeDecimalText,
    perpQuantity: nonnegativeDecimalText,
    netEconomicExposure: decimalText,
  }),
  expectedNetReturnAmount: decimalText,
  expectedNetReturnBps: decimalText,
  assumptions: z.array(z.string()),
});
export type SkHynixArbitragePreview = z.infer<typeof SkHynixArbitragePreviewSchema>;

export const SkHynixArbitragePositionSchema = z.strictObject({
  id: z.string(),
  specVersion: z.string(),
  state: z.enum(['OPEN', 'PARTIALLY_CLOSED']),
  perpVenue: z.string(),
  perpSymbol: z.string(),
  remainingEquityQuantity: nonnegativeDecimalText,
  remainingPerpQuantity: nonnegativeDecimalText,
  equityAverageEntryPrice: nonnegativeDecimalText,
  perpAverageEntryPrice: nonnegativeDecimalText,
  fundingCashflow: decimalText,
  fundingAttributionState: z.enum(['VERIFIED', 'AMBIGUOUS', 'UNAVAILABLE']),
  commissionsAndFees: nonnegativeDecimalText,
  netPnl: decimalText,
  residualEconomicExposure: decimalText,
  rowVersion: z.number().int().positive(),
  openedAt: timestamp,
  updatedAt: timestamp,
});
export type SkHynixArbitragePosition = z.infer<typeof SkHynixArbitragePositionSchema>;

export const SkHynixArbitragePositionsResponseSchema = z.strictObject({
  items: z.array(SkHynixArbitragePositionSchema),
  fetchedAt: timestamp,
});
export type SkHynixArbitragePositionsResponse = z.infer<typeof SkHynixArbitragePositionsResponseSchema>;
