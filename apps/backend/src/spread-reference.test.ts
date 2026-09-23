import { describe, expect, it, vi } from 'vitest';
import { SpreadReference } from './spread-reference.js';
const HOUR = 3600000;
const candle = (startTime: number, close: string, closed = true) => ({ startTime, close, open: close, high: close, low: close, volume: '1', closed });
const settle = () => new Promise(resolve => setImmediate(resolve));
describe('七天 K 线内存基准', () => {
  it('仅对齐已收盘有效小时，算术平均每小时价差，不计算均价之比', async () => {
    const now = 200 * HOUR;
    const load = vi.fn(async (symbol: string) => symbol === 'a' ? [candle(now - HOUR, '100'), candle(now - 2 * HOUR, '200'), candle(now, '1', false), candle(now - 169 * HOUR, '1')] : [candle(now - HOUR, '110'), candle(now - 2 * HOUR, '180'), candle(now - 3 * HOUR, '9'), candle(now, '999', false)]);
    const history = new SpreadReference(load, () => now);
    history.ensure(['a', 'a', 'b']); await settle();
    const h = history.read('a', 'b');
    expect(h.points).toHaveLength(2); expect(h.mean).toBeCloseTo(0); expect(h.sufficient).toBe(false);
    const calls = load.mock.calls.length;
    history.ensure(['a', 'b']); await settle(); expect(load).toHaveBeenCalledTimes(calls);
    history.stop();
  });
  it('完整七天立即可用，小时收盘增量更新并淘汰窗外数据', async () => {
    let now = 200 * HOUR + 20000;
    const load = vi.fn(async () => Array.from({ length: 168 }, (_, i) => candle(Math.floor(now / HOUR) * HOUR - (i + 1) * HOUR, '100')));
    const history = new SpreadReference(load, () => now);
    history.ensure(['a', 'b']); await settle(); expect(history.read('a', 'b').sufficient).toBe(true);
    now += HOUR; expect(history.read('a', 'b').sufficient).toBe(false);
    history.ensure(['a', 'b']); await settle();
    expect(load.mock.calls).toHaveLength(4);
    expect(history.read('a', 'b').points).toHaveLength(168); expect(history.read('a', 'b').sufficient).toBe(true);
    history.stop();
  });
  it('失败重试有退避，旧基准过期不会继续允许推送', async () => {
    let now = 200 * HOUR;
    const load = vi.fn(async () => { throw new Error('network'); });
    const history = new SpreadReference(load, () => now);
    history.ensure(['a']); await settle(); history.ensure(['a']); await settle(); expect(load).toHaveBeenCalledTimes(1);
    expect(history.read('a', 'b').reason).toContain('失败');
    now += 60000; history.ensure(['a']); await settle(); expect(load).toHaveBeenCalledTimes(2);
    history.stop();
  });
  it('窗口扩大分页补齐 30 天，缩小复用缓存并重新计算均值与覆盖率', async () => {
    const now = 1000 * HOUR;
    const load = vi.fn(async (symbol: string, limit: number, before = now) => Array.from({ length: 720 }, (_, i) => candle(now - (i + 1) * HOUR, symbol === 'a' || i < 24 ? '100' : '101')).filter(c => c.startTime < before).slice(0, Math.min(limit, 100)));
    const history = new SpreadReference(load, () => now);
    history.ensure(['a', 'b'], 1); await settle();
    expect(history.read('a', 'b', 1).mean).toBe(0);
    history.ensure(['a', 'b'], 30); await settle();
    const h = history.read('a', 'b', 30);
    expect(h.points).toHaveLength(720); expect(h.coverage).toBe(1); expect(h.sufficient).toBe(true);
    expect(h.mean).toBeCloseTo(100 * 696 / 720);
    expect(load.mock.calls.some(call => call[2] !== undefined)).toBe(true);
    const calls = load.mock.calls.length;
    history.ensure(['a', 'b'], 3); await settle();
    expect(history.read('a', 'b', 3).points).toHaveLength(72);
    expect(load).toHaveBeenCalledTimes(calls);
    history.stop();
  });

});
