interface PositionDisplayItem {
  quantity: number;
  symbol: string;
  side?: string;
}

function sideRank(position: PositionDisplayItem): number {
  const side = position.side?.toUpperCase();
  if (side === 'LONG' || side === 'BUY') return 0;
  if (side === 'SHORT' || side === 'SELL') return 1;
  if (position.quantity > 0) return 0;
  if (position.quantity < 0) return 1;
  return 2;
}

/** Stable position order shared by the trade and strategy tables: long, short, then flat/hedged. */
export function comparePositionDisplayOrder(left: PositionDisplayItem, right: PositionDisplayItem): number {
  const sideDifference = sideRank(left) - sideRank(right);
  return sideDifference || left.symbol.localeCompare(right.symbol);
}
