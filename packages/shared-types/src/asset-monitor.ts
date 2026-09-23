import { z } from 'zod';

export const OBSERVATION_VENUES = ['BINANCE', 'OKX', 'BYBIT', 'GATE', 'KRAKEN', 'HYPERLIQUID'] as const;
export const ObservationVenueSchema = z.enum(OBSERVATION_VENUES);
export type ObservationVenue = z.infer<typeof ObservationVenueSchema>;
const decimal = z.string().regex(/^\d+(?:\.\d+)?$/);
export const StableDepthSchema = z.object({ payAmount: decimal, buyAmount: decimal, levels: z.number().int().nonnegative(), complete: z.boolean() });
export type StableDepth = z.infer<typeof StableDepthSchema>;
export const ObservationMarketSchema = z.object({
  id: z.string(), venue: ObservationVenueSchema, nativeSymbol: z.string(),
  base: z.string(), quote: z.string(), product: z.enum(['spot', 'perpetual']), category: z.enum(['stable', 'gold']),
  bid: decimal.nullable(), ask: decimal.nullable(), bidSize: decimal.nullable(), askSize: decimal.nullable(),
  forwardDepth: StableDepthSchema.nullable().optional(), reverseDepth: StableDepthSchema.nullable().optional(),
  observedAt: z.number().finite(), sourceAt: z.number().finite().nullable(), error: z.string().nullable(),
});
export type ObservationMarket = z.infer<typeof ObservationMarketSchema>;
export const ObservationSettingsSchema = z.object({
  threshold: z.string().regex(/^0\.\d{1,6}$/).refine(v => Number(v) >= 0.5 && Number(v) < 1),
  durationSeconds: z.number().int().min(10).max(86400),
  notificationsEnabled: z.boolean(), paymentCoins: z.enum(['both', 'USDT', 'USDC']), bidirectional: z.boolean(),
  minPayAmount: z.number().finite().min(0).max(1_000_000_000).default(100),
});
export type ObservationSettings = z.infer<typeof ObservationSettingsSchema>;
export const DEFAULT_OBSERVATION_SETTINGS: ObservationSettings = { threshold: '0.99', durationSeconds: 30, notificationsEnabled: false, paymentCoins: 'both', bidirectional: true, minPayAmount: 100 };
export const StableDirectionSchema = z.object({
  id: z.string(), marketId: z.string(), venue: ObservationVenueSchema, nativeSymbol: z.string(),
  buy: z.string(), pay: z.string(), inverse: z.boolean(), price: decimal.nullable(), payAmount: decimal.nullable(),
  marketStats: z.object({ marketCapUsd: z.number().finite().nonnegative().nullable(), volume24hUsd: z.number().finite().nonnegative().nullable(), updatedAt: z.number() }).nullable().optional(),
  depthTo0998: StableDepthSchema.nullable().optional(),
  status: z.enum(['normal', 'discount', 'stale']), durationSeconds: z.number(), observedAt: z.number(),
});
export type StableDirection = z.infer<typeof StableDirectionSchema>;
export function observationPaymentAllowed(pay: string, settings: ObservationSettings): boolean {
  return settings.paymentCoins === 'both' ? pay === 'USDT' || pay === 'USDC' : pay === settings.paymentCoins;
}
export function observationDirectionEligible(direction: StableDirection, settings: ObservationSettings): boolean {
  return (settings.bidirectional || !direction.inverse) && observationPaymentAllowed(direction.pay, settings)
    && direction.payAmount !== null && Number(direction.payAmount) >= settings.minPayAmount;
}
export const GoldAlertSettingsSchema = z.object({
  thresholdBps: z.number().finite().positive().max(10000),
  durationSeconds: z.number().int().min(1).max(86400),
  recoveryBps: z.number().finite().min(0).max(10000),
  recoverySeconds: z.number().int().min(1).max(86400),
  notificationsEnabled: z.boolean(),
}).refine(s => s.recoveryBps < s.thresholdBps, {message:'恢复阈值必须小于触发阈值',path:['recoveryBps']});
export type GoldAlertSettings = z.infer<typeof GoldAlertSettingsSchema>;
export const DEFAULT_GOLD_ALERT_SETTINGS: GoldAlertSettings = {thresholdBps:35,durationSeconds:20,recoveryBps:30,recoverySeconds:20,notificationsEnabled:true};
export const GoldQuoteSchema = z.object({
  market: ObservationMarketSchema, bid: decimal.nullable(), ask: decimal.nullable(),
  normalizedAt: z.number().nullable(), conversion: z.string(), ready: z.boolean(),
});
export type GoldQuote = z.infer<typeof GoldQuoteSchema>;
export const ObservationEventSchema = z.object({ id: z.number(), directionId: z.string(), message: z.string(), createdAt: z.number(), status: z.enum(['recorded', 'pending', 'sent', 'failed', 'unknown']) });
export const ObservationSnapshotSchema = z.object({
  updatedAt: z.number().nullable(), pollingMs: z.number(), staleMs: z.number(), settings: ObservationSettingsSchema, barkConfigured: z.boolean(),
  goldSettings: GoldAlertSettingsSchema.optional(),
  marketStatsError: z.string().nullable().optional(),
  stable: z.array(StableDirectionSchema), gold: z.array(GoldQuoteSchema),
  sources: z.array(z.object({ venue: ObservationVenueSchema, product: z.enum(['spot', 'perpetual']), count: z.number(), checkedAt: z.number(), error: z.string().nullable() })),
  registry: z.array(z.string()), events: z.array(ObservationEventSchema),
});
export type ObservationSnapshot = z.infer<typeof ObservationSnapshotSchema>;
export const ObservationHistorySchema = z.object({
  nextBefore:z.number().nullable().optional(), hasMore:z.boolean().optional(),
  source: z.enum(['local_samples','exchange_candles']).default('local_samples'), loadedAt:z.number().default(0), quote:z.string().default('USDT'), referenceIntervalMs:z.number().default(60000), warning:z.string().nullable().default(null),
  points: z.array(z.object({ time: z.number(), value: z.number(), leftClose: z.number(), rightClose: z.number() })),
  sampleCount: z.number(), intervalMs: z.number(), startedAt: z.number().nullable(),
  reference: z.object({ minPct:z.number().nullable().optional(), maxPct:z.number().nullable().optional(), hours: z.number(), meanPct: z.number().nullable(), sampleCount: z.number(), expectedSamples: z.number(), coverage: z.number(), latestAt: z.number().nullable(), sufficient: z.boolean(), fresh: z.boolean() }),
});
export type ObservationHistory = z.infer<typeof ObservationHistorySchema>;
