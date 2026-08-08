import type { PortfolioFuturesPosition } from '@gate-crossex/shared-types';

interface PositionReference {
  position_id: string;
  symbol: string;
  funding_fee?: string | null;
}

/** Add settled funding to mark-to-market PnL. Unknown funding is treated as zero. */
export function pnlIncludingSettledFunding(pricePnl: number, fundingFee: number | null): number {
  return pricePnl + (fundingFee ?? 0);
}

/** Net open-position PnL after settled funding and trading fees already charged to the position. */
export function netPositionPnl(
  pricePnl: number,
  fundingFee: number | null,
  tradingFee: number | null,
): number {
  return pnlIncludingSettledFunding(pricePnl, fundingFee) - (tradingFee ?? 0);
}

function matchingPortfolioPosition(
  position: PositionReference,
  portfolioPositions: readonly PortfolioFuturesPosition[],
): PortfolioFuturesPosition | undefined {
  const exact = portfolioPositions.find((candidate) => candidate.positionId === position.position_id);
  if (exact) return exact;
  const symbolMatches = portfolioPositions.filter((candidate) => candidate.symbol === position.symbol);
  return symbolMatches.length === 1 ? symbolMatches[0] : undefined;
}

/** Match the execution row to the authenticated accounting row without guessing between dual-side positions. */
export function positionFundingFee(
  position: PositionReference,
  portfolioPositions: readonly PortfolioFuturesPosition[],
): number | null {
  if (position.funding_fee !== undefined && position.funding_fee !== null && position.funding_fee.trim() !== '') {
    const directValue = Number(position.funding_fee);
    if (Number.isFinite(directValue)) return directValue;
  }
  const match = matchingPortfolioPosition(position, portfolioPositions);
  if (!match || match.fundingFee.trim() === '') return null;
  const value = Number(match.fundingFee);
  return Number.isFinite(value) ? value : null;
}

/** Use the exchange's position-level fee so historical fills cannot leak into the open position. */
export function positionTradingFee(
  position: PositionReference,
  portfolioPositions: readonly PortfolioFuturesPosition[],
): number | null {
  const match = matchingPortfolioPosition(position, portfolioPositions);
  if (!match || match.fee.trim() === '') return null;
  const value = Number(match.fee);
  return Number.isFinite(value) ? value : null;
}

export function aggregatePositionFundingFee(
  positions: readonly PositionReference[],
  portfolioPositions: readonly PortfolioFuturesPosition[],
): number | null {
  const values = positions.map((position) => positionFundingFee(position, portfolioPositions));
  return values.every((value): value is number => value !== null)
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
}

export function aggregatePositionTradingFee(
  positions: readonly PositionReference[],
  portfolioPositions: readonly PortfolioFuturesPosition[],
): number | null {
  const values = positions.map((position) => positionTradingFee(position, portfolioPositions));
  return values.every((value): value is number => value !== null)
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
}
