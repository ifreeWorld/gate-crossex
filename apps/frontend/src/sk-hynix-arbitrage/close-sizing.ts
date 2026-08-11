export type CloseFraction = '0.25' | '0.5' | '0.75' | '1';

const fractionParts: Record<CloseFraction, readonly [numerator: bigint, denominator: bigint]> = {
  '0.25': [1n, 4n],
  '0.5': [1n, 2n],
  '0.75': [3n, 4n],
  '1': [1n, 1n],
};

export function closeFractionQuantity(remainingShares: string, fraction: CloseFraction): string {
  const shares = BigInt(remainingShares);
  const [numerator, denominator] = fractionParts[fraction];
  return ((shares * numerator) / denominator).toString();
}
