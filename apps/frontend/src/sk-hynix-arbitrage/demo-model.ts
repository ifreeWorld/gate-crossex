import type { SkHynixArbitrageOpportunity, SkHynixArbitragePosition } from '@gate-crossex/shared-types';

export interface DemoOrderCalculation {
  equityShares: number;
  perpQuantity: string;
  equitySide: 'BUY' | 'SELL';
  perpSide: 'BUY' | 'SELL';
  reduceOnly: boolean;
  equityNotionalUsdt: string;
  perpNotionalUsdt: string;
  mismatchUsdt: string;
  mismatchPct: string;
  fxExposureUsd: string;
  executableSpreadBps: string;
  expectedNetReturnAmount: string;
  remainingEquityShares: number;
  remainingPerpQuantity: string;
}

interface DemoOrderInput {
  mode: 'OPEN' | 'CLOSE';
  opportunity: SkHynixArbitrageOpportunity;
  requestedNotional: string;
  position: SkHynixArbitragePosition | null;
  closeShares: number | null;
}

export function deriveDemoOrder(input: DemoOrderInput): DemoOrderCalculation {
  const opening = input.mode === 'OPEN';
  const equityPrice = Number(opening ? input.opportunity.equityQuote.askUsdt : input.opportunity.equityQuote.bidUsdt);
  const perpPrice = Number(opening ? input.opportunity.perpQuote.bid : input.opportunity.perpQuote.ask);
  const availableShares = Math.max(0, Math.floor(Number(input.position?.remainingEquityQuantity ?? '0')));
  const equityShares = opening
    ? Math.max(1, Math.floor(Number(input.requestedNotional) / equityPrice))
    : Math.min(availableShares, Math.max(0, Math.floor(input.closeShares ?? availableShares)));
  const equityNotional = equityShares * equityPrice;
  const perpNotional = equityShares * perpPrice;
  const mismatch = perpNotional - equityNotional;
  const remainingEquityShares = opening ? equityShares : availableShares - equityShares;
  const availablePerp = Number(input.position?.remainingPerpQuantity ?? '0');
  const remainingPerp = opening ? equityShares : Math.max(0, availablePerp - equityShares);
  const spread = opening
    ? (perpPrice / equityPrice - 1) * 10_000
    : (equityPrice / perpPrice - 1) * 10_000;
  const expectedReturn = opening
    ? equityNotional * Number(input.opportunity.expectedNetReturnBps) / 10_000
    : -(Math.abs(mismatch) + 1.5);
  return {
    equityShares,
    perpQuantity: equityShares.toFixed(3),
    equitySide: opening ? 'BUY' : 'SELL',
    perpSide: opening ? 'SELL' : 'BUY',
    reduceOnly: !opening,
    equityNotionalUsdt: equityNotional.toFixed(2),
    perpNotionalUsdt: perpNotional.toFixed(2),
    mismatchUsdt: mismatch.toFixed(2),
    mismatchPct: (equityNotional === 0 ? 0 : Math.abs(mismatch) / equityNotional * 100).toFixed(2),
    fxExposureUsd: (remainingEquityShares * equityPrice * Number(input.opportunity.fx.usdtUsd)).toFixed(2),
    executableSpreadBps: spread.toFixed(2),
    expectedNetReturnAmount: expectedReturn.toFixed(2),
    remainingEquityShares,
    remainingPerpQuantity: remainingPerp.toFixed(3),
  };
}
