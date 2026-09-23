import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FundingOverviewResponse, OrderBookSnapshot } from '@gate-crossex/shared-types';
import { DEFAULT_SPREAD_SETTINGS, SpreadSettingsSchema } from '@gate-crossex/shared-types';
import { SpreadMonitor, type SpreadBookSource } from './spread-monitor.js';

const id = 'GATE_FUTURE_BTC_USDT~BINANCE_FUTURE_BTC_USDT';
const resources: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of resources.splice(0)) await close(); });
function fixture(warm = true) {
  const db = new Database(':memory:');
  db.exec(readFileSync(new URL('../../../migrations/0018_spread_monitor.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../../../migrations/0019_spread_recovery.sql', import.meta.url), 'utf8'));
  let now = Date.UTC(2026, 8, 20, 12);
  let bid = '100.2';
  let stale = false;
  let depth = '100';
  const symbols: string[] = [];
  const feed: SpreadBookSource = {
    connections: 1,
    setSymbols: s => { symbols.splice(0, symbols.length, ...s); },
    book: symbol => ({ symbol, asks: [[symbol.startsWith('GATE') ? '100' : '100.3', depth]], bids: [[symbol.startsWith('GATE') ? '99.9' : bid, depth]], updatedAt: new Date(now - (stale ? 10000 : 0)).toISOString(), source: 'gate_crossex_websocket' } satisfies OrderBookSnapshot),
    stop: () => undefined,
  };
  const load = vi.fn(async (): Promise<FundingOverviewResponse> => ({ assets: [{ asset: 'BTC', venues: ['GATE', 'BINANCE'].map(venue => ({ venue, symbol: `${venue}_FUTURE_BTC_USDT`, quote: 'USDT', fundingRate: '.0001', fundingRate8h: '.0001', fundingIntervalHours: 8, nextFundingAt: null, openInterestValue: venue === 'GATE' ? '10000000' : null, lastPrice: '100', change24h: null, fetchedAt: new Date(now).toISOString() })) }], venueStatus: [], fetchedAt: new Date(now).toISOString(), cacheStatus: 'fresh' }));
  const candles = async () => warm ? Array.from({ length: 168 }, (_, i) => ({ startTime: Math.floor(now / 3600000) * 3600000 - (i + 1) * 3600000, open: '100', high: '100', low: '100', close: '100', volume: '1', closed: true })) : [];
  const send = vi.fn(async () => 'sent' as const);
  const caps = new Map<string, number>();
  const marketCaps = { refresh: vi.fn(async () => {}), get: (asset: string) => caps.get(asset) ?? null, error: null, stop: () => {} };
  const monitor = new SpreadMonitor(db, feed, load, { marketCaps, now: () => now, candles, send, configured: () => true });
  resources.push(async () => { await monitor.stop(); db.close(); });
  const step = (ms = 1000) => { now += ms; monitor.tick(); };
  const enable = async () => { await monitor.refresh(); monitor.save({ ...DEFAULT_SPREAD_SETTINGS, venues: ['GATE','BINANCE'], historyDays: 7, notificationsEnabled: true, durationSeconds: 2 }); };
  const row = () => monitor.snapshot().rows.find(r => r.id === id)!;
  return { caps, marketCaps, candles, db, monitor, feed, send, load, symbols, row, step, enable, time: () => now, bid: (v: string) => { bid = v; }, stale: (v: boolean) => { stale = v; }, depth: (v: string) => { depth = v; } };
}

describe('价差监控状态和持久化', () => {
  it('默认 7 天，旧设置补上新字段，拒绝无效窗口', () => {
    const f = fixture(false);
    expect(f.monitor.settings.historyDays).toBe(7);
    const legacy = { ...DEFAULT_SPREAD_SETTINGS, historyDays: undefined };
    expect(SpreadSettingsSchema.parse(legacy).historyDays).toBe(7);
    expect(SpreadSettingsSchema.safeParse({ ...legacy, historyDays: 2 }).success).toBe(false);
    f.db.prepare('INSERT INTO spread_settings VALUES (1, ?)').run(JSON.stringify({ ...legacy, amountUsd: 2000 }));
    const restarted = new SpreadMonitor(f.db, f.feed, f.load);
    expect(restarted.settings.historyDays).toBe(7);
    expect(restarted.settings.amountUsd).toBe(2000);
  });
  it('市值筛选独立于持仓量，等于门槛通过，未知排除，后台订阅和提醒同步生效', async () => {
    const f = fixture(); await f.enable(); f.step();
    expect(f.row().averageOiUsd).toBe(10000000);
    expect(f.marketCaps.refresh).not.toHaveBeenCalled();
    f.monitor.save({ ...f.monitor.settings, minMarketCapMillions: 100 });
    await f.monitor.refresh(); f.step(); f.step(); f.step();
    expect(f.monitor.snapshot().rows).toHaveLength(0);
    expect(f.symbols).toHaveLength(0);
    expect(f.monitor.notices()).toHaveLength(0);
    expect(f.monitor.snapshot().marketCapStatus?.unknownAssets).toBe(1);
    f.caps.set('BTC', 100e6);
    await f.monitor.refresh(); await vi.waitFor(() => expect(f.symbols).toHaveLength(2)); f.step();
    expect(f.row().marketCapUsd).toBe(100e6);
    expect(f.row().elapsedSeconds).toBe(0);
    f.step(); f.step(); expect(f.monitor.notices()).toHaveLength(1);
    f.monitor.save({ ...f.monitor.settings, minOiMillions: 11 }); f.step();
    expect(f.monitor.snapshot().rows).toHaveLength(0);
    f.monitor.save({ ...f.monitor.settings, minOiMillions: 0, minMarketCapMillions: 101 }); f.step();
    expect(f.monitor.snapshot().rows).toHaveLength(0);
    f.monitor.save({ ...f.monitor.settings, minMarketCapMillions: 0 }); f.step();
    expect(f.monitor.snapshot().rows).toHaveLength(2);
  });
  it('市值过期变未知后停止监控，旧设置兼容，新门槛重启保留', async () => {
    const f = fixture(); await f.enable();
    f.caps.set('BTC', 200e6);
    f.monitor.save({ ...f.monitor.settings, minMarketCapMillions: 100 }); f.step();
    expect(f.monitor.snapshot().rows).toHaveLength(2);
    f.caps.clear(); f.step();
    expect(f.monitor.snapshot().rows).toHaveLength(0);
    await f.monitor.stop();
    const restarted = new SpreadMonitor(f.db, f.feed, f.load);
    expect(restarted.settings.minMarketCapMillions).toBe(100);
    await restarted.stop();
    expect(SpreadSettingsSchema.parse({ ...DEFAULT_SPREAD_SETTINGS, minMarketCapMillions: undefined }).minMarketCapMillions).toBe(0);
    for (const value of [-1, NaN, Infinity]) expect(SpreadSettingsSchema.safeParse({ ...DEFAULT_SPREAD_SETTINGS, minMarketCapMillions: value }).success).toBe(false);
  });
  it('启动拉取七天历史即可使用，实时盘口不污染均值，也不写历史表', async () => {
    const f = fixture(); await f.enable(); f.step();
    expect(f.row().status).toBe('watching');
    expect(f.row().meanBps).toBe(0);
    expect(f.row().coverage).toBe(1);
    f.bid('100.1'); f.step();
    expect(f.row().meanBps).toBe(0);
    expect(f.row().deviationBps).toBeCloseTo(f.row().referenceBps!);
    f.monitor.flush();
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM spread_history').get()).toEqual({ n: 0 });
  });
  it('窗口设置生效、重启保留，并重置累计时间但不重复通知', async () => {
    const f = fixture(); await f.enable(); f.step(); f.step(); f.step();
    expect(f.monitor.notices()).toHaveLength(1);
    f.monitor.save({ ...f.monitor.settings, historyDays: 3 }); f.step();
    expect(f.row().historyHours).toBe(72); expect(f.row().elapsedSeconds).toBe(0);
    f.step(); f.step(); expect(f.monitor.notices()).toHaveLength(1);
    await f.monitor.stop();
    const restarted = new SpreadMonitor(f.db, f.feed, f.load, { now: () => f.time(), candles: f.candles });
    expect(restarted.settings.historyDays).toBe(3); await restarted.stop();
  });
  it('推送关闭且无人访问时，后台启动即采样并持续刷新目录', async () => {
    vi.useFakeTimers();
    const f = fixture(false);
    const refresh = vi.spyOn(f.monitor, 'refresh');
    const tick = vi.spyOn(f.monitor, 'tick');
    try {
      f.monitor.start();
      await f.monitor.refresh();
      expect(f.symbols).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(120000);
      expect(tick).toHaveBeenCalledTimes(120);
      expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(f.symbols).toHaveLength(2);
      expect(f.monitor.notices()).toHaveLength(0);
    } finally { await f.monitor.stop(); vi.useRealTimers(); }
  });
  it('跨 USDT/USDC 直接使用原始报价，列表与详情不依赖汇率请求', async () => {
    const f = fixture();
    const data = await f.load();
    data.assets[0].venues[1].quote = 'USDC';
    data.assets[0].venues[1].symbol = 'BINANCE_FUTURE_BTC_USDC';
    f.load.mockResolvedValue(data);
    const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('external network unavailable'));
    try {
      await f.monitor.refresh(); f.step();
      const row = f.monitor.snapshot().rows.find(r => r.buyVenue === 'GATE')!;
      expect(row.spreadBps).toBeCloseTo(20);
      expect(row.referenceBps).toBeCloseTo((100.25 / 99.95 - 1) * 10000);
      expect(row.referenceBps!).toBeGreaterThanOrEqual(row.spreadBps!);
      const detail = f.monitor.detail(row.id, 1000)!;
      expect(detail.estimate?.spreadBps).toBe(row.spreadBps);
      expect(detail.capacity).toEqual(row.capacity);
      expect(f.monitor.snapshot().coverage.error).toBeNull();
      expect(request).not.toHaveBeenCalled();
    } finally { request.mockRestore(); }
  });
  it('目录失败时已有盘口仍可计算列表和详情', async () => {
    const f = fixture(false); await f.monitor.refresh(); f.step();
    expect(f.row().spreadBps).not.toBeNull();
    f.load.mockRejectedValue(new Error('catalog timeout'));
    f.step(121000);
    expect(f.row().spreadBps).not.toBeNull();
    expect(f.monitor.snapshot().coverage.error).toBeNull();
    expect(f.monitor.detail(id, 1000)?.estimate).not.toBeNull();
    await f.monitor.refresh(); f.step();
    expect(f.row().spreadBps).not.toBeNull();
  });
  it('目录请求未返回时仍使用最新盘口计算', async () => {
    const f = fixture(false); await f.monitor.refresh();
    const data = await f.load();
    let finish!: (data: FundingOverviewResponse) => void;
    f.load.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.monitor.refresh();
    await new Promise(resolve => setImmediate(resolve));
    f.step(121000);
    expect(f.row().spreadBps).not.toBeNull();
    const next = f.monitor.refresh();
    await new Promise(resolve => setImmediate(resolve));
    f.step();
    const spread = f.row().spreadBps;
    finish(data); await Promise.all([pending, next]);
    expect(spread).not.toBeNull();
  });
  it('首次累计达标只推一次，恢复后可再次提醒', async () => {
    const f = fixture(); await f.enable();
    f.step(); expect(f.row().status).toBe('watching');
    f.step(); f.step(); await Promise.resolve();
    expect(f.monitor.notices()).toHaveLength(1);
    f.step(); f.step(); expect(f.monitor.notices()).toHaveLength(1);
    f.bid('99.6'); f.step(); expect(f.row().elapsedSeconds).toBe(0);
    f.bid('100.2'); f.step(); f.step(); f.step();
    expect(f.monitor.notices()).toHaveLength(2);
    expect(f.row().estimate?.buyNotional).toBe('1000');
    expect(f.row().capacity).not.toBeNull();
  });
  it('历史不足不提醒，深度不足不覆盖历史状态', async () => {
    const f = fixture(false); await f.enable(); f.step(); f.step(); f.step();
    expect(f.row().status).toBe('warming'); expect(f.monitor.notices()).toHaveLength(0);
    f.depth('1'); f.step(); expect(f.row().status).toBe('warming');
  });
  it('深度不足仍按参考偏离计时和提醒，恢复后重新进入也能提醒', async () => {
    const f = fixture(); await f.enable(); f.depth('1');
    f.step(); expect(f.row().status).toBe('watching');
    expect(f.row().estimate).toBeNull();
    expect(f.row().capacity && Number(f.row().capacity!.amountUsd)).toBeLessThan(1000);
    f.step(); f.step(); await Promise.resolve();
    expect(f.row().status).toBe('ready');
    expect(f.monitor.notices()).toHaveLength(1);
    expect(f.monitor.notices()[0].body).toContain('深度不足');
    f.step(); f.step(); expect(f.monitor.notices()).toHaveLength(1);
    f.bid('99.6'); f.step();
    expect(f.row().status).toBe('below'); expect(f.row().elapsedSeconds).toBe(0);
    f.bid('100.2'); f.step(); f.step(); f.step();
    expect(f.monitor.notices()).toHaveLength(2);
  });
  it('市价价差低于成交阈值、容量为零，也不拦截参考偏离达标', async () => {
    const f = fixture(); await f.enable(); f.bid('100');
    f.step(); f.step(); f.step();
    expect(f.row().spreadBps).toBe(0);
    expect(f.row().capacity?.amountUsd).toBe('0');
    expect(f.row().deviationBps).toBeGreaterThan(f.monitor.settings.thresholdBps);
    expect(f.row().status).toBe('ready');
    expect(f.monitor.notices()).toHaveLength(1);
  });
  it('过期暂停，重新收到有效行情不累计未知间隔', async () => {
    const f = fixture(); await f.enable(); f.step(); f.step();
    expect(f.row().elapsedSeconds).toBe(1);
    f.stale(true); f.step(); f.step(); expect(f.row().elapsedSeconds).toBe(1);
    f.stale(false); f.step(); expect(f.row().elapsedSeconds).toBe(1);
    f.step(); expect(f.row().status).toBe('ready');
  });
  it('关闭再开启不重复发送本轮；重启保留轮次和历史年龄', async () => {
    const f = fixture(); await f.enable(); f.step(); f.step(); f.step();
    f.monitor.save({ ...f.monitor.settings, notificationsEnabled: false }); f.step();
    f.monitor.save({ ...f.monitor.settings, notificationsEnabled: true }); f.step();
    expect(f.monitor.notices()).toHaveLength(1);
    await f.monitor.stop();
    const restarted = new SpreadMonitor(f.db, f.feed, f.load, { now: () => f.time(), candles: f.candles, configured: () => true, send: f.send });
    await restarted.refresh(); restarted.tick();
    expect(restarted.snapshot().rows.find(r => r.id === id)?.historyHours).toBe(168);
    expect(restarted.notices()).toHaveLength(1); await restarted.stop();
  });
  it('金额变化复用同一 K 线基准，缺失 OI 不按零平均', async () => {
    const f = fixture(); await f.enable(); f.step();
    expect(f.row().averageOiUsd).toBe(10000000);
    f.monitor.save({ ...f.monitor.settings, amountUsd: 2000 }); f.step();
    expect(f.row().meanBps).toBe(0);
    expect(f.monitor.historyPoints(id, 60, f.time(), 1000)).toEqual(f.monitor.historyPoints(id, 60, f.time(), 2000));
    expect(f.monitor.historyPoints(id, 60, f.time(), 1000)).toHaveLength(168);
  });
  it('修改阈值不能制造恢复并重复推送，真实价差恢复后才可重发', async () => {
    const f = fixture(); await f.enable(); f.step(); f.step(); f.step();
    expect(f.monitor.notices()).toHaveLength(1);
    f.monitor.save({ ...f.monitor.settings, thresholdBps: 30 }); f.step(); f.step();
    f.monitor.save({ ...f.monitor.settings, thresholdBps: 5 }); f.step(); f.step(); f.step();
    expect(f.monitor.notices()).toHaveLength(1);
    f.bid('99.6'); f.step(); f.bid('100.2'); f.step(); f.step(); f.step();
    expect(f.monitor.notices()).toHaveLength(2);
  });
  it('缺失 Bark 配置拒绝开启', () => {
    const f = fixture(false);
    const m = new SpreadMonitor(f.db, f.feed, f.load, { configured: () => false });
    expect(() => m.save({ ...DEFAULT_SPREAD_SETTINGS, notificationsEnabled: true })).toThrow('bark_not_configured');
  });
});


it.each(['expired', 'out_of_sync'] as const)('短暂异常保留独立展示值，%s 期间暂停提醒，恢复后继续计时', async cause => {
  const f = fixture(); await f.enable(); f.step(); f.step();
  const valid = f.row();
  expect(valid.elapsedSeconds).toBe(1);
  const original = f.feed.book;
  let lag = cause === 'expired' ? 6000 : 3000;
  f.feed.book = symbol => ({ ...original(symbol)!, updatedAt: new Date(f.time() - (symbol.startsWith('BINANCE') ? lag : 0)).toISOString() });
  f.step(); f.step(); f.step();
  expect(f.row().staleCause).toBe(cause);
  expect(f.row().lastValid).toMatchObject({ spreadBps: valid.spreadBps, capacity: valid.capacity, updatedAt: valid.updatedAt });
  expect(f.row().spreadBps).toBeNull();
  expect(f.row().estimate).toBeNull();
  expect(f.row().capacity).toBeNull();
  expect(f.row().elapsedSeconds).toBe(1);
  expect(f.monitor.detail(id, 1000)?.estimate).toBeNull();
  expect(f.monitor.detail(id, 1000)?.capacity).toBeNull();
  expect(f.monitor.notices()).toHaveLength(0);
  lag = 0; f.step();
  expect(f.row().lastValid).toBeUndefined();
  expect(f.row().spreadBps).not.toBeNull();
  expect(f.row().elapsedSeconds).toBe(1);
  f.step(); expect(f.monitor.notices()).toHaveLength(1);
});

it('展示缓存不跨越一分钟、成交口径或移除后重新加入的监控方向', async () => {
  const f = fixture(); await f.enable(); f.step();
  f.stale(true); f.step(); expect(f.row().lastValid).toBeDefined();
  f.step(61000); expect(f.row().lastValid).toBeUndefined();
  for (const patch of [{ amountUsd: 2000 }, { thresholdBps: 6 }, { historyDays: 3 }]) {
    f.stale(false); f.step(); f.stale(true); f.step();
    expect(f.row().lastValid).toBeDefined();
    f.monitor.save({ ...f.monitor.settings, ...patch }); f.step();
    expect(f.row().lastValid).toBeUndefined();
  }
  f.stale(false); f.step();
  f.monitor.save({ ...f.monitor.settings, minOiMillions: 20 }); f.step();
  expect(f.monitor.snapshot().rows).toHaveLength(0);
  f.stale(true);
  f.monitor.save({ ...f.monitor.settings, minOiMillions: 0 }); f.step();
  expect(f.row().lastValid).toBeUndefined();
});


it('测试通知在推送关闭时可发送，记录结果且不改变设置和去重状态', async () => {
  const f = fixture();
  const settings = JSON.stringify(f.monitor.settings);
  expect(await f.monitor.testNotification()).toEqual({ status: 'sent' });
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.monitor.notices()[0]).toMatchObject({ directionId: 'test', status: 'sent', title: '价差监控 · 测试通知' });
  expect(JSON.stringify(f.monitor.settings)).toBe(settings);
  expect(f.db.prepare('SELECT * FROM spread_episodes').all()).toHaveLength(0);
});

it('测试通知异常记为未知，不自动重试；未配置拒绝发送', async () => {
  const f = fixture(); f.send.mockRejectedValueOnce(new Error('timeout'));
  expect(await f.monitor.testNotification()).toEqual({ status: 'unknown' });
  expect(f.monitor.notices()[0].status).toBe('unknown');
  expect(f.send).toHaveBeenCalledTimes(1);
  const unconfigured = new SpreadMonitor(f.db, f.feed, f.load, { configured: () => false });
  await expect(unconfigured.testNotification()).rejects.toThrow('bark_not_configured');
  expect(f.monitor.notices()).toHaveLength(1);
  await unconfigured.stop();
});
