import { Decimal } from 'decimal.js';
import type { SpreadExecutionEstimate, SpreadCapacity } from '@gate-crossex/shared-types';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_DOWN });
export type SpreadLevel = [string, string];

/** 输入为同一基础币的数量；保留原始报价，不做汇率换算。任何非法档位使整本盘口不可用。 */
export function normalizeSpreadLevels(levels: SpreadLevel[], side: 'asks' | 'bids'): SpreadLevel[] {
  const valid: SpreadLevel[] = [];
  for (const [p, q] of levels) {
    try {
      const price = new D(p);
      const qty = new D(q);
      if (!price.isFinite() || !qty.isFinite() || price.lte(0) || qty.lt(0)) return [];
      if (qty.gt(0)) valid.push([price.toString(), qty.toString()]);
    } catch { return []; }
  }
  return valid.sort((a, b) => new D(a[0]).cmp(b[0]) * (side === 'asks' ? 1 : -1));
}

function consume(levels: SpreadLevel[], quantity: Decimal) {
  let remaining = quantity;
  let notional = new D(0);
  for (const [p, q] of levels) {
    const take = D.min(remaining, q);
    notional = notional.add(take.mul(p));
    remaining = remaining.sub(take);
    if (remaining.lte(0)) break;
  }
  return remaining.gt(0) ? null : notional;
}

/** asks 升序、bids 降序，须由 normalizeSpreadLevels 验证；输出不包含手续费或交易精度取整。 */
export function estimateSpreadQuantity(asks: SpreadLevel[], bids: SpreadLevel[], quantity: string): SpreadExecutionEstimate | null {
  let q: Decimal;
  try { q = new D(quantity); } catch { return null; }
  if (!q.isFinite() || q.lte(0) || !asks.length || !bids.length) return null;
  const buy = consume(asks, q);
  const sell = consume(bids, q);
  if (!buy || !sell || buy.lte(0)) return null;
  const spread = sell.div(buy).sub(1).mul(10000);
  const top = new D(bids[0][0]).div(asks[0][0]).sub(1).mul(10000);
  return {
    quantity: q.toString(), buyVwap: buy.div(q).toString(), sellVwap: sell.div(q).toString(),
    buyNotional: buy.toString(), sellNotional: sell.toString(), spreadBps: spread.toNumber(), impactBps: top.sub(spread).toNumber(),
  };
}

export function estimateSpreadAmount(asks: SpreadLevel[], bids: SpreadLevel[], amountUsd: number): SpreadExecutionEstimate | null {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;
  let remaining = new D(amountUsd);
  let quantity = new D(0);
  for (const [p, q] of asks) {
    const cost = D.min(remaining, new D(p).mul(q));
    quantity = quantity.add(cost.div(p));
    remaining = remaining.sub(cost);
    if (remaining.lte(0)) break;
  }
  if (remaining.gt(0)) return null;
  return estimateSpreadQuantity(asks, bids, quantity.toString());
}

/** 同步扫描双边深度。在跨越阈值的档位内解析求解，不使用重复遍历全盘口的二分。 */
export function spreadCapacity(asks: SpreadLevel[], bids: SpreadLevel[], minimumBps: number): SpreadCapacity | null {
  if (!asks.length || !bids.length || !Number.isFinite(minimumBps)) return null;
  const ratio = new D(1).add(new D(minimumBps).div(10000));
  let quantity = new D(0), buy = new D(0), sell = new D(0);
  let ai = 0, bi = 0;
  let aq = new D(asks[0][1]), bq = new D(bids[0][1]);
  while (ai < asks.length && bi < bids.length) {
    const ap = new D(asks[ai][0]), bp = new D(bids[bi][0]);
    let take = D.min(aq, bq);
    const slope = bp.sub(ap.mul(ratio));
    const surplus = sell.sub(buy.mul(ratio));
    const crosses = surplus.add(take.mul(slope)).lt(0);
    if (crosses) take = D.max(0, surplus.div(slope.neg()));
    quantity = quantity.add(take); buy = buy.add(take.mul(ap)); sell = sell.add(take.mul(bp));
    if (crosses) return { amountUsd: buy.toString(), quantity: quantity.toString(), depthLimited: false };
    aq = aq.sub(take); bq = bq.sub(take);
    if (aq.isZero()) { ai++; if (asks[ai]) aq = new D(asks[ai][1]); }
    if (bq.isZero()) { bi++; if (bids[bi]) bq = new D(bids[bi][1]); }
  }
  return { amountUsd: buy.toString(), quantity: quantity.toString(), depthLimited: true };
}
