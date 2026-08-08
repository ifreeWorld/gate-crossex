import type { MarketSnapshot } from './api.js';

const LIVE_MARKET_MAX_AGE_MS = 60_000;

export interface LivePositionFunding {
  rate: number;
  nextFundingAt: string;
}

/** Only label funding as live when it came from CrossEx WebSocket and its market is still fresh. */
export function livePositionFunding(
  snapshot: MarketSnapshot | null,
  symbol: string,
  now: number,
): LivePositionFunding | null {
  const market = snapshot?.markets.find((candidate) => candidate.symbol === symbol);
  if (!market || market.source !== 'gate_crossex_websocket') return null;
  const updatedAt = Date.parse(market.updatedAt);
  const nextFundingAt = Date.parse(market.nextFundingAt);
  const rate = Number(market.fundingRate);
  if (!Number.isFinite(updatedAt) || now - updatedAt > LIVE_MARKET_MAX_AGE_MS
    || !Number.isFinite(nextFundingAt) || !Number.isFinite(rate)) return null;
  return { rate, nextFundingAt: market.nextFundingAt };
}

export function fundingRateText(rate: number): string {
  return `${rate > 0 ? '+' : ''}${(rate * 100).toFixed(4)}%`;
}

/**
 * Estimate the cash flow at the next settlement from the current mark notional.
 * Positive means the account receives funding; negative means it pays funding.
 */
export function estimatedPositionFunding(
  quantity: number,
  markPrice: number,
  rate: number,
): number | null {
  if (!Number.isFinite(quantity) || quantity === 0
    || !Number.isFinite(markPrice) || markPrice <= 0
    || !Number.isFinite(rate)) return null;
  return -Math.sign(quantity) * Math.abs(quantity * markPrice) * rate;
}

export function fundingEstimateText(
  estimate: number,
  quote: string,
  receiveLabel: string,
  payLabel: string,
  fundingDirection: string,
  estimateNote: string,
): string {
  const label = estimate >= 0 ? receiveLabel : payLabel;
  return `${label} ${Math.abs(estimate).toFixed(4)} ${quote}\n${fundingDirection}\n${estimateNote}`;
}
