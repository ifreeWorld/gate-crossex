import { describe, expect, it } from 'vitest';
import type { Candle } from './api.js';
import {
  aggregatePremiumHistoryWeeks,
  buildPremiumHistory,
  buildPremiumMovingAverages,
  mergeCandleHistory,
  PREMIUM_HISTORY_TIMEFRAMES,
  premiumHistoryViewKey,
} from './premium-history.js';

function candle(startTime: number, close: string): Candle {
  return { startTime, open: close, high: close, low: close, close, volume: '1', closed: true };
}

describe('buildPremiumHistory', () => {
  it('calculates premium from aligned ADR and ratio-scaled hedge closes', () => {
    const points = buildPremiumHistory(
      [candle(1_000, '225'), candle(2_000, '238')],
      [candle(1_000, '1800'), candle(2_000, '1750')],
      10,
      0,
    );

    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ time: 1_000, adrClose: 225, hedgeClose: 1800 });
    expect(points[0].value).toBeCloseTo(25);
    expect(points[1].value).toBeCloseTo(36);
  });

  it('keeps only timestamps shared by both legs and inside the requested range', () => {
    const points = buildPremiumHistory(
      [candle(1_000, '220'), candle(2_000, '225'), candle(3_000, '230')],
      [candle(1_000, '1800'), candle(3_000, '1800')],
      10,
      1_500,
    );

    expect(points.map((point) => point.time)).toEqual([3_000]);
  });

  it('returns no points for an invalid ratio or unusable prices', () => {
    expect(buildPremiumHistory([candle(1_000, '225')], [candle(1_000, '1800')], 0, 0)).toEqual([]);
    expect(buildPremiumHistory([candle(1_000, '0')], [candle(1_000, '1800')], 10, 0)).toEqual([]);
  });
});

describe('mergeCandleHistory', () => {
  it('prepends older candles, deduplicates timestamps, and keeps incoming updates', () => {
    expect(mergeCandleHistory(
      [candle(2_000, '20'), candle(3_000, '30')],
      [candle(1_000, '10'), candle(2_000, '21')],
    )).toEqual([
      candle(1_000, '10'),
      candle(2_000, '21'),
      candle(3_000, '30'),
    ]);
  });
});

describe('premiumHistoryViewKey', () => {
  it('resets the chart viewport when switching timeframes', () => {
    const pairKey = 'GATE_FUTURE_SKHY_USDT:GATE_FUTURE_SKHYNIX_USDT';
    expect(premiumHistoryViewKey(pairKey, '1D', '10'))
      .not.toBe(premiumHistoryViewKey(pairKey, '1W', '10'));
  });
});

describe('premium history timeframes', () => {
  it('offers minute, hourly, daily, and weekly views', () => {
    expect(PREMIUM_HISTORY_TIMEFRAMES.map((item) => item.label))
      .toEqual(['1m', '5m', '15m', '1H', '4H', '1D', '1W']);
  });

  it('builds weekly points from the last synchronized daily close in each UTC ISO week', () => {
    const point = (iso: string, value: number) => ({
      time: Date.parse(iso), value, adrClose: value + 100, hedgeClose: 1_000,
    });
    const points = aggregatePremiumHistoryWeeks([
      point('2026-08-03T00:00:00.000Z', 1),
      point('2026-08-05T00:00:00.000Z', 2),
      point('2026-08-09T00:00:00.000Z', 3),
      point('2026-08-10T00:00:00.000Z', 4),
    ]);

    expect(points.map((item) => item.value)).toEqual([3, 4]);
    expect(points[0]?.time).toBe(Date.parse('2026-08-09T00:00:00.000Z'));
  });
});

describe('premium moving averages', () => {
  it('calculates MA5, MA10, and MA20 only after each full window is available', () => {
    const points = Array.from({ length: 20 }, (_, index) => ({
      time: (index + 1) * 60_000,
      value: index + 1,
      adrClose: 100 + index,
      hedgeClose: 1_000,
    }));

    const averages = buildPremiumMovingAverages(points);

    expect(averages.map((series) => series.period)).toEqual([5, 10, 20]);
    expect(averages.map((series) => series.points.length)).toEqual([16, 11, 1]);
    expect(averages[0]?.points.at(-1)?.value).toBeCloseTo(18);
    expect(averages[1]?.points.at(-1)?.value).toBeCloseTo(15.5);
    expect(averages[2]?.points.at(-1)?.value).toBeCloseTo(10.5);
  });
});
