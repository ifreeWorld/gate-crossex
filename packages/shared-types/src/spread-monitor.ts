import { z } from 'zod';
export const SPREAD_VENUES = ['GATE', 'BINANCE', 'OKX', 'BYBIT', 'KRAKEN', 'HYPERLIQUID'] as const;
export const SPREAD_HISTORY_DAYS = [1, 3, 7, 30] as const;
export const spreadHistoryLabel = (days: number) => days === 1 ? '24 小时' : `${days} 天`;
export const SpreadSettingsSchema = z.object({
  venues: z.array(z.enum(SPREAD_VENUES)).min(2).max(6).refine(v => new Set(v).size === v.length),
  minMarketCapMillions: z.number().finite().min(0).max(1e9).default(0),
  minOiMillions: z.number().finite().min(0).max(1e9),
  amountUsd: z.number().finite().min(10).max(1e8),
  thresholdBps: z.number().finite().min(0.1).max(10000),
  durationSeconds: z.number().int().min(1).max(86400),
  notificationsEnabled: z.boolean(),
  historyDays: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(30)]).default(7),
});
export type SpreadSettings = z.infer<typeof SpreadSettingsSchema>;
export const DEFAULT_SPREAD_SETTINGS: SpreadSettings = { venues: [...SPREAD_VENUES], minOiMillions: 0, minMarketCapMillions: 0, amountUsd: 1000, thresholdBps: 5, durationSeconds: 300, notificationsEnabled: false, historyDays: 7 };
export interface SpreadExecutionEstimate {
  quantity: string; buyVwap: string; sellVwap: string; buyNotional: string; sellNotional: string; spreadBps: number; impactBps: number;
}
export interface SpreadCapacity { amountUsd: string; quantity: string; depthLimited: boolean }
export type SpreadStatus = 'ready' | 'watching' | 'below' | 'warming' | 'stale' | 'insufficient_depth';
/** 仅供过期时展示，不参与成交估算、计时或提醒。 */
export interface SpreadLastValid {
  spreadBps: number; referenceBps: number | null; meanBps: number | null; deviationBps: number | null;
  coverage: number; capacity: SpreadCapacity | null; updatedAt: string;
}
export interface SpreadDirection {
  lastValid?: SpreadLastValid;
  staleCause?: 'out_of_sync' | 'expired' | 'unavailable';
  buyNativeMarket?: string; sellNativeMarket?: string;
  id: string; asset: string; buySymbol: string; sellSymbol: string; buyVenue: string; sellVenue: string;
  marketCapUsd?: number | null;
  referenceBps?: number | null; averageOiUsd: number | null; spreadBps: number | null; meanBps: number | null; deviationBps: number | null;
  coverage: number; historyHours: number; elapsedSeconds: number; status: SpreadStatus; reason: string | null;
  estimate: SpreadExecutionEstimate | null; capacity: SpreadCapacity | null; updatedAt: string | null;
  buyFunding: { rate: string | null; rate8h: string | null; hours: number | null; nextAt: string | null };
  sellFunding: SpreadDirection['buyFunding'];
}
export interface SpreadNotice { id: number; directionId: string; title: string; body: string; status: 'pending' | 'sent' | 'failed' | 'unknown'; createdAt: string }
export interface SpreadSnapshot {
  marketCapStatus?: { unknownAssets: number; error: string | null };
  settings: SpreadSettings; barkConfigured: boolean; rows: SpreadDirection[]; updatedAt: string;
  coverage: { assets: number; symbols: number; validSymbols: number; connections: number; error: string | null };
}
export interface SpreadHistoryPoint { time: number; value: number; count: number }
const finite = z.number().finite();
export const SpreadEstimateSchema = z.object({ quantity: z.string(), buyVwap: z.string(), sellVwap: z.string(), buyNotional: z.string(), sellNotional: z.string(), spreadBps: finite, impactBps: finite });
const capacitySchema = z.object({ amountUsd: z.string(), quantity: z.string(), depthLimited: z.boolean() });
const fundingSchema = z.object({ rate: z.string().nullable(), rate8h: z.string().nullable(), hours: finite.nullable(), nextAt: z.string().nullable() });
const lastValidSchema = z.object({ spreadBps: finite, referenceBps: finite.nullable(), meanBps: finite.nullable(), deviationBps: finite.nullable(), coverage: finite, capacity: capacitySchema.nullable(), updatedAt: z.string() });
export const SpreadDirectionSchema = z.object({
  lastValid: lastValidSchema.optional(), staleCause: z.enum(['out_of_sync', 'expired', 'unavailable']).optional(),
  buyNativeMarket: z.string().optional(), sellNativeMarket: z.string().optional(), id: z.string(), asset: z.string(), buySymbol: z.string(), sellSymbol: z.string(), buyVenue: z.string(), sellVenue: z.string(), referenceBps: finite.nullable().optional(), averageOiUsd: finite.nullable(), marketCapUsd: finite.nonnegative().nullable().optional(), spreadBps: finite.nullable(), meanBps: finite.nullable(), deviationBps: finite.nullable(), coverage: finite, historyHours: finite, elapsedSeconds: finite, status: z.enum(['ready','watching','below','warming','stale','insufficient_depth']), reason: z.string().nullable(), estimate: SpreadEstimateSchema.nullable(), capacity: capacitySchema.nullable(), updatedAt: z.string().nullable(), buyFunding: fundingSchema, sellFunding: fundingSchema,
});
export const SpreadSnapshotSchema = z.object({ marketCapStatus: z.object({ unknownAssets: finite, error: z.string().nullable() }).optional(), settings: SpreadSettingsSchema, barkConfigured: z.boolean(), rows: z.array(SpreadDirectionSchema), updatedAt: z.string(), coverage: z.object({ assets: finite, symbols: finite, validSymbols: finite, connections: finite, error: z.string().nullable() }) });
export const SpreadDetailSchema = z.object({ row: SpreadDirectionSchema, estimate: SpreadEstimateSchema.nullable(), capacity: capacitySchema.nullable() });
export const SpreadHistorySchema = z.object({ points: z.array(z.object({ time: finite, value: finite, count: finite })) });
export const SpreadNoticesSchema = z.object({ notices: z.array(z.object({ id: finite, directionId: z.string(), title: z.string(), body: z.string(), status: z.enum(['pending','sent','failed','unknown']), createdAt: z.string() })) });
