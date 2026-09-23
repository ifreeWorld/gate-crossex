import { describe, expect, it } from 'vitest';
import { estimateSpreadAmount, estimateSpreadQuantity, normalizeSpreadLevels, spreadCapacity } from './spread-execution.js';
import type { SpreadLevel } from './spread-execution.js';

describe('市价价差估算', () => {
  const asks: SpreadLevel[] = [['100', '2'], ['102', '3']];
  const bids: SpreadLevel[] = [['104', '1'], ['103', '4']];
  it('逐档吃单并以同一基础数量计算双边 VWAP', () => {
    const value = estimateSpreadAmount(asks, bids, 302)!;
    expect(value.quantity).toBe('3');
    expect(value.buyNotional).toBe('302');
    expect(value.sellNotional).toBe('310');
    expect(Number(value.buyVwap)).toBeCloseTo(302 / 3);
    expect(value.spreadBps).toBeCloseTo((310 / 302 - 1) * 10000);
    expect(value.impactBps).toBeCloseTo(400 - value.spreadBps);
  });
  it('卖方深度不足时不能算作足额成交', () => {
    expect(estimateSpreadAmount(asks, [['104', '1']], 200)).toBeNull();
    expect(estimateSpreadAmount(asks, bids, 1000)).toBeNull();
    expect(estimateSpreadQuantity(asks, bids, 'invalid')).toBeNull();
  });
  it('保留负价差，小数数量不被截断为整数', () => {
    const value = estimateSpreadAmount([['100', '.5']], [['99', '.5']], 25)!;
    expect(value.quantity).toBe('.25'.replace(/^\./, '0.'));
    expect(value.spreadBps).toBe(-100);
  });
  it('在阈值跨越档位内求解容量，而不是仅按最后一档报价', () => {
    const a: SpreadLevel[] = [['100','1'], ['102','10']];
    const b: SpreadLevel[] = [['103','11']];
    const cap = spreadCapacity(a, b, 200)!;
    const filled = estimateSpreadQuantity(a, b, cap.quantity)!;
    expect(cap.depthLimited).toBe(false);
    expect(filled.spreadBps).toBeCloseTo(200, 8);
    expect(Number(cap.quantity)).toBeGreaterThan(1);
  });
  it('区分零容量、已知深度上限与缺少盘口', () => {
    expect(spreadCapacity([['100','2']], [['99','2']], 0)).toEqual({ quantity: '0', amountUsd: '0', depthLimited: false });
    expect(spreadCapacity([['100','2']], [['101','1']], 50)).toEqual({ quantity: '1', amountUsd: '100', depthLimited: true });
    expect(spreadCapacity([], bids, 1)).toBeNull();
  });
  it('原始报价排序与非法档位拒绝', () => {
    expect(normalizeSpreadLevels([['102','2'], ['100','1']], 'asks')).toEqual([['100','1'], ['102','2']]);
    expect(normalizeSpreadLevels([['100','1'], ['bad','2']], 'asks')).toEqual([]);
    expect(normalizeSpreadLevels([['100','-1']], 'asks')).toEqual([]);
  });
});
