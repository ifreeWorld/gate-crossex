export interface PremiumPositionQuantity {
  positionSide: string;
  quantity: string;
}

export interface PremiumReduceOnlyDefaults {
  directionFlipped: boolean;
  adrQuantity: string;
  hedgeQuantity: string;
}

function signedQuantity(position: PremiumPositionQuantity): number {
  const quantity = Number(position.quantity) || 0;
  const side = position.positionSide.toUpperCase();
  if (side === 'SHORT') return -Math.abs(quantity);
  if (side === 'LONG') return Math.abs(quantity);
  return quantity;
}

function absoluteQuantityText(position: PremiumPositionQuantity): string {
  const value = position.quantity.trim().replace(/^-/, '');
  if (!/^\d+(?:\.\d+)?$/.test(value) || !(Number(value) > 0)) return '';
  return value.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** Exact, position-derived defaults for closing the SKHY/SKHYNIX pair. */
export function premiumReduceOnlyDefaults(
  adrPosition: PremiumPositionQuantity | undefined,
  hedgePosition: PremiumPositionQuantity | undefined,
): PremiumReduceOnlyDefaults | null {
  if (!adrPosition || !hedgePosition) return null;
  const adrQuantity = absoluteQuantityText(adrPosition);
  const hedgeQuantity = absoluteQuantityText(hedgePosition);
  const adrSigned = signedQuantity(adrPosition);
  const hedgeSigned = signedQuantity(hedgePosition);
  if (!adrQuantity || !hedgeQuantity || adrSigned * hedgeSigned >= 0) return null;
  return { directionFlipped: adrSigned < 0, adrQuantity, hedgeQuantity };
}
