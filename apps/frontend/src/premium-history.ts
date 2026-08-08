import type { Candle, CandleInterval } from './api.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export const PREMIUM_HISTORY_TIMEFRAMES = [
  { label: '1m', sourceInterval: '1m', visibleDurationMs: 120 * MINUTE_MS, requestLimit: 300, refreshMs: 30_000 },
  { label: '5m', sourceInterval: '5m', visibleDurationMs: 120 * 5 * MINUTE_MS, requestLimit: 300, refreshMs: 60_000 },
  { label: '15m', sourceInterval: '15m', visibleDurationMs: 120 * 15 * MINUTE_MS, requestLimit: 300, refreshMs: 60_000 },
  { label: '1H', sourceInterval: '1h', visibleDurationMs: 120 * HOUR_MS, requestLimit: 300, refreshMs: 2 * MINUTE_MS },
  { label: '4H', sourceInterval: '4h', visibleDurationMs: 120 * 4 * HOUR_MS, requestLimit: 300, refreshMs: 5 * MINUTE_MS },
  { label: '1D', sourceInterval: '1d', visibleDurationMs: 120 * DAY_MS, requestLimit: 300, refreshMs: 15 * MINUTE_MS },
  // Weekly points are built from venue-native daily closes so every supported venue behaves the
  // same even when its public API has no native 1w interval.
  { label: '1W', sourceInterval: '1d', visibleDurationMs: 52 * WEEK_MS, requestLimit: 500, refreshMs: 15 * MINUTE_MS },
] as const satisfies ReadonlyArray<{
  label: string;
  sourceInterval: CandleInterval;
  visibleDurationMs: number;
  requestLimit: number;
  refreshMs: number;
}>;

export type PremiumHistoryTimeframe = typeof PREMIUM_HISTORY_TIMEFRAMES[number]['label'];

export const PREMIUM_MOVING_AVERAGE_STYLES = [
  { period: 5, color: '#e8a317' },
  { period: 10, color: '#e33d79' },
  { period: 20, color: '#20abc4' },
] as const;

export interface PremiumHistoryPoint {
  time: number;
  value: number;
  adrClose: number;
  hedgeClose: number;
}

export interface PremiumMovingAveragePoint {
  time: number;
  value: number;
}

export interface PremiumMovingAverageSeries {
  period: number;
  color: string;
  points: PremiumMovingAveragePoint[];
}

/** Timeframe belongs in the chart key because daily and weekly views share the daily source. */
export function premiumHistoryViewKey(pairKey: string, timeframe: string, adrRatio: string): string {
  return `${pairKey}:${timeframe}:${adrRatio}`;
}

export function mergeCandleHistory(current: Candle[], incoming: Candle[]): Candle[] {
  const byStartTime = new Map(current.map((candle) => [candle.startTime, candle]));
  for (const candle of incoming) byStartTime.set(candle.startTime, candle);
  return [...byStartTime.values()].sort((left, right) => left.startTime - right.startTime);
}

/**
 * Builds one venue-pair premium series from timestamp-aligned candle closes.
 *
 * One hedge share represents `adrRatio` ADRs, so its fair per-ADR value is
 * hedgeClose / adrRatio and premium = ADR / fair value - 1.
 */
export function buildPremiumHistory(
  adrCandles: Candle[],
  hedgeCandles: Candle[],
  adrRatio: number,
  since: number,
): PremiumHistoryPoint[] {
  if (!Number.isFinite(adrRatio) || adrRatio <= 0) return [];

  const hedgeByTime = new Map(hedgeCandles.map((candle) => [candle.startTime, Number(candle.close)]));
  const points: PremiumHistoryPoint[] = [];
  for (const candle of adrCandles) {
    if (candle.startTime < since) continue;
    const adrClose = Number(candle.close);
    const hedgeClose = hedgeByTime.get(candle.startTime);
    if (!Number.isFinite(adrClose) || adrClose <= 0 || hedgeClose === undefined || !Number.isFinite(hedgeClose) || hedgeClose <= 0) continue;
    points.push({
      time: candle.startTime,
      value: ((adrClose * adrRatio) / hedgeClose - 1) * 100,
      adrClose,
      hedgeClose,
    });
  }
  return points.sort((left, right) => left.time - right.time);
}

/** Keep the last synchronized daily close in each UTC ISO week (Monday through Sunday). */
export function aggregatePremiumHistoryWeeks(points: PremiumHistoryPoint[]): PremiumHistoryPoint[] {
  const latestByWeek = new Map<number, PremiumHistoryPoint>();
  for (const point of points) {
    const date = new Date(point.time);
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    const weekStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday);
    const current = latestByWeek.get(weekStart);
    if (!current || point.time > current.time) latestByWeek.set(weekStart, point);
  }
  return [...latestByWeek.values()].sort((left, right) => left.time - right.time);
}

/** Simple moving averages of premium closes in the currently selected chart timeframe. */
export function buildPremiumMovingAverages(points: PremiumHistoryPoint[]): PremiumMovingAverageSeries[] {
  return PREMIUM_MOVING_AVERAGE_STYLES.map(({ period, color }) => {
    let sum = 0;
    const movingAveragePoints: PremiumMovingAveragePoint[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      if (!point) continue;
      sum += point.value;
      const expired = points[index - period];
      if (expired) sum -= expired.value;
      if (index >= period - 1) movingAveragePoints.push({ time: point.time, value: sum / period });
    }
    return { period, color, points: movingAveragePoints };
  });
}
