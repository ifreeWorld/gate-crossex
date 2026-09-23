import type Database from 'better-sqlite3';
import { DEFAULT_SPREAD_SETTINGS, SpreadSettingsSchema, type FundingOverviewResponse, type OrderBookSnapshot, type SpreadDirection, type SpreadHistoryPoint, type SpreadNotice, type SpreadSettings, type SpreadSnapshot } from '@gate-crossex/shared-types';
import { estimateSpreadAmount, normalizeSpreadLevels, spreadCapacity } from '@gate-crossex/domain';
import { SpreadReference, type SpreadCandleLoader } from './spread-reference.js';
import { barkConfigured, sendSpreadBark } from './spread-bark.js';

import { SpreadMarketCaps, type SpreadMarketCapSource } from './spread-market-caps.js';

const DAY = 86400000;
export interface SpreadBookSource { marketName?(symbol: string): string | undefined; setSymbols(symbols: string[]): void; book(symbol: string): OrderBookSnapshot | null; connections: number; readonly error?: string | null; issue?(symbol: string): string | null; stop(): void }
type Leg = FundingOverviewResponse['assets'][number]['venues'][number];
export class SpreadMonitor {
  settings: SpreadSettings;
  private marketCaps: SpreadMarketCapSource;
  private capsPending: Promise<void> | null = null;
  private rows: SpreadDirection[] = [];
  private lastValid = new Map<string, NonNullable<SpreadDirection['lastValid']>>();
  private assets: FundingOverviewResponse['assets'] = [];
  private reference: SpreadReference;
  private elapsed = new Map<string, number>();
  private notified = new Set<string>();
  private lastTick = 0;
  private qualifiedAt = new Map<string, number>();
  private recovery = new Map<string, { amount: number; spread: number | null }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private refreshPending: Promise<void> | null = null;
  private stopped = false;
  private error: string | null = null;
  private sendQueue = Promise.resolve();
  private cleanupAt = 0;
  constructor(private db: Database.Database, private feed: SpreadBookSource, private load: () => Promise<FundingOverviewResponse>, private options: { now?: () => number; send?: typeof sendSpreadBark; configured?: () => boolean; candles?: SpreadCandleLoader; marketCaps?: SpreadMarketCapSource } = {}) {
    this.marketCaps = options.marketCaps ?? new SpreadMarketCaps({ now: () => this.now() });
    this.reference = new SpreadReference(options.candles ?? (async () => []), () => this.now());
    const saved = db.prepare('SELECT payload FROM spread_settings WHERE id = 1').get() as { payload: string } | undefined;
    const parsed = saved ? SpreadSettingsSchema.safeParse(JSON.parse(saved.payload)) : null;
    this.settings = parsed?.success ? parsed.data : { ...DEFAULT_SPREAD_SETTINGS };
    for (const row of db.prepare('SELECT direction_id, amount_usd, recovery_bps FROM spread_episodes WHERE notified = 1').all() as { direction_id: string; amount_usd: number; recovery_bps: number | null }[]) { this.notified.add(row.direction_id); this.recovery.set(row.direction_id, { amount: row.amount_usd, spread: row.recovery_bps }); }
    db.prepare("UPDATE spread_notices SET status = 'unknown' WHERE status = 'pending'").run();
  }
  private now() { return this.options.now?.() ?? Date.now(); }
  configured() { return (this.options.configured ?? barkConfigured)(); }
  start() {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => { this.tick(); }, 1000); this.timer.unref?.();
    this.refreshTimer = setInterval(() => { void this.refresh(); }, 60000); this.refreshTimer.unref?.();
    this.flushTimer = setInterval(() => this.flush(), 60000); this.flushTimer.unref?.();
    void this.refresh();
  }
  async view() { this.start(); if (!this.assets.length) await this.refresh(); return this.snapshot(); }
  refresh(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.refreshPending ??= this.refreshOnce().finally(() => { this.refreshPending = null; });
    this.refreshMarketCaps();
    return this.refreshPending;
  }
  private async refreshOnce() {
    try {
      const data = await this.load(); if (this.stopped) return;
      this.assets = data.assets; this.error = null;
      if (!this.stopped) { this.reconcile(); this.refreshMarketCaps(); }
    } catch { this.error = '交易对目录或持仓量加载失败，正在重试'; }
  }
  private refreshMarketCaps() {
    if (this.stopped || !this.settings.minMarketCapMillions || !this.assets.length || this.capsPending) return;
    this.capsPending = this.marketCaps.refresh(this.assets.map(asset => asset.asset)).then(() => {
      if (!this.stopped) this.reconcile();
    }).finally(() => { this.capsPending = null; });
  }
  private selected() {
    const now = this.now();
    return this.assets.map(a => {
      const legs = a.venues.filter(v => this.settings.venues.includes(v.venue as SpreadSettings['venues'][number]));
      const values = legs.filter(v => v.fetchedAt && now - Date.parse(v.fetchedAt) <= 10 * 60000).map(v => v.openInterestValue === null ? NaN : Number(v.openInterestValue)).filter(v => Number.isFinite(v) && v >= 0);
      const oi = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      return { asset: a.asset, legs, oi, marketCap: this.marketCaps.get(a.asset) };
    }).filter(a => a.legs.length >= 2 && (this.settings.minOiMillions === 0 || a.oi !== null && a.oi >= this.settings.minOiMillions * 1e6) && (this.settings.minMarketCapMillions === 0 || a.marketCap !== null && a.marketCap >= this.settings.minMarketCapMillions * 1e6));
  }
  private reconcile() { const symbols = this.selected().flatMap(a => a.legs.map(l => l.symbol)); this.feed.setSymbols(symbols); this.reference.ensure(symbols, this.settings.historyDays); }
  save(input: unknown) {
    const settings = SpreadSettingsSchema.parse(input);
    if (settings.notificationsEnabled && !this.configured()) throw new Error('bark_not_configured');
    const changed = settings.minMarketCapMillions !== this.settings.minMarketCapMillions || settings.amountUsd !== this.settings.amountUsd || settings.thresholdBps !== this.settings.thresholdBps || settings.durationSeconds !== this.settings.durationSeconds || settings.historyDays !== this.settings.historyDays;
    if (settings.amountUsd !== this.settings.amountUsd || settings.thresholdBps !== this.settings.thresholdBps || settings.historyDays !== this.settings.historyDays) this.lastValid.clear();
    this.db.prepare('INSERT INTO spread_settings VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload').run(JSON.stringify(settings));
    this.settings = settings; if (changed) { this.elapsed.clear(); this.qualifiedAt.clear(); }
    this.start(); this.reconcile(); this.rows = []; void this.refresh();
    return this.snapshot();
  }
  tick() {
    if (this.stopped) return;
    const now = this.now(); if (now - this.lastTick < 900) return;
    const delta = this.lastTick && now - this.lastTick <= 2500 ? (now - this.lastTick) / 1000 : 0; this.lastTick = now;
    const rows: SpreadDirection[] = [];
    for (const asset of this.selected()) {
      const books = new Map(asset.legs.map(leg => {
        const book = this.feed.book(leg.symbol);
        const time = book ? Date.parse(book.updatedAt) : 0;
        const valid = book && now - time <= 5000 && time <= now + 1000;
        const asks = valid ? normalizeSpreadLevels(book.asks, 'asks') : [];
        const bids = valid ? normalizeSpreadLevels(book.bids, 'bids') : [];
        const issue = (!book ? this.feed.issue?.(leg.symbol) ?? `${leg.venue} 尚未收到盘口` : now - time > 5000 ? `${leg.venue} 盘口超过 5 秒未更新` : time > now + 1000 ? `${leg.venue} 盘口时间异常` : !asks.length || !bids.length || Number(bids[0][0]) > Number(asks[0][0]) ? `${leg.venue} 盘口无效` : null);
        return [leg.symbol, { time, asks, bids, issue, valid: !!valid && asks.length > 0 && bids.length > 0 && Number(bids[0][0]) <= Number(asks[0][0]) }] as const;
      }));
      for (const buy of asset.legs) for (const sell of asset.legs) {
        if (buy.venue === sell.venue) continue;
        const id = `${buy.symbol}~${sell.symbol}`; const b = books.get(buy.symbol)!; const s = books.get(sell.symbol)!;
        const h = this.reference.read(buy.symbol, sell.symbol, this.settings.historyDays);
        const mean = h.mean;
        const coverage = h.coverage;
        const historyHours = h.hours;
        const sufficient = h.sufficient;
        const valid = b.valid && s.valid && Math.abs(b.time - s.time) <= 2000;
        const estimate = valid ? estimateSpreadAmount(b.asks, s.bids, this.settings.amountUsd) : null;
        // 中间价、成交价差、容量与历史基准统一使用原始报价，不请求或应用汇率。
        const referenceBps = valid ? (((Number(s.asks[0][0]) + Number(s.bids[0][0]))) / ((Number(b.asks[0][0]) + Number(b.bids[0][0]))) - 1) * 10000 : null;
        const deviation = referenceBps !== null && mean !== null ? referenceBps - mean : null;
        let status: SpreadDirection['status'] = !valid ? 'stale' : !sufficient ? 'warming' : deviation! < this.settings.thresholdBps ? 'below' : 'watching';
        let elapsed = this.elapsed.get(id) ?? 0;
        if (valid && deviation !== null && deviation < this.settings.thresholdBps) elapsed = 0;
        // 价差信号与成交能力分离；已推送轮次按触发时的参考价差恢复线判断。
        const recovery = this.recovery.get(id);
        if (valid && recovery) {
          if (recovery.spread === null && mean !== null && sufficient) {
            recovery.spread = mean + this.settings.thresholdBps;
            this.db.prepare('UPDATE spread_episodes SET recovery_bps = ? WHERE direction_id = ?').run(recovery.spread, id);
          }
          if (referenceBps !== null && recovery.spread !== null && referenceBps < recovery.spread) this.rearm(id);
        }
        if (status === 'watching') {
          const previous = this.qualifiedAt.get(id);
          if (previous === now - delta * 1000 && delta > 0) elapsed += delta;
          this.qualifiedAt.set(id, now);
          if (elapsed >= this.settings.durationSeconds) status = 'ready';
        } else this.qualifiedAt.delete(id);
        this.elapsed.set(id, elapsed);
        const funding = (leg: Leg) => { const fresh = leg.fetchedAt && now - Date.parse(leg.fetchedAt) <= 600000; return { rate: fresh ? leg.fundingRate : null, rate8h: fresh ? leg.fundingRate8h : null, hours: leg.fundingIntervalHours, nextAt: leg.nextFundingAt }; };
        const row: SpreadDirection = { id, asset: asset.asset, buySymbol: buy.symbol, sellSymbol: sell.symbol, buyNativeMarket: this.feed.marketName?.(buy.symbol), sellNativeMarket: this.feed.marketName?.(sell.symbol), buyVenue: buy.venue, sellVenue: sell.venue, averageOiUsd: asset.oi, marketCapUsd: asset.marketCap, spreadBps: estimate?.spreadBps ?? null, referenceBps, meanBps: mean, deviationBps: deviation, coverage, historyHours, elapsedSeconds: Math.floor(elapsed), status, reason: !valid ? b.issue ?? s.issue ?? '双边盘口时间差超过 2 秒' : status === 'warming' ? h.reason : !estimate ? '目标金额深度不足，仅价差信号达标时计时' : null, estimate, capacity: valid && mean !== null ? spreadCapacity(b.asks, s.bids, mean + this.settings.thresholdBps) : null, updatedAt: valid ? new Date(Math.min(b.time, s.time)).toISOString() : null, buyFunding: funding(buy), sellFunding: funding(sell) };
        // 保留独立的展示快照，当前行情字段仍为空，避免旧值进入提醒和详情估算。
        if (valid && estimate && row.updatedAt) {
          this.lastValid.set(id, { spreadBps: estimate.spreadBps, referenceBps, meanBps: mean, deviationBps: deviation, coverage, capacity: row.capacity, updatedAt: row.updatedAt });
        } else if (!valid) {
          row.staleCause = b.valid && s.valid ? 'out_of_sync' : [b, s].some(book => book.time > 0 && now - book.time > 5000) ? 'expired' : 'unavailable';
          const cached = this.lastValid.get(id);
          if (cached && now - Date.parse(cached.updatedAt) <= 60000) row.lastValid = cached;
        }
        rows.push(row);
        if (status === 'ready' && this.settings.notificationsEnabled && !this.notified.has(id)) this.notify(row);
      }
    }
    const activeIds = new Set(rows.map(r => r.id));
    for (const id of this.qualifiedAt.keys()) if (!activeIds.has(id)) this.qualifiedAt.delete(id);
    for (const [id, cached] of this.lastValid) if (!activeIds.has(id) || now - Date.parse(cached.updatedAt) > 60000) this.lastValid.delete(id);
    this.rows = rows;
  }
  private rearm(id: string) { this.recovery.delete(id); if (this.notified.delete(id)) this.db.prepare('DELETE FROM spread_episodes WHERE direction_id = ?').run(id); }
  async testNotification() {
    if (!this.configured()) throw new Error('bark_not_configured');
    const title = '价差监控 · 测试通知';
    const body = 'Bark 推送通道测试。正式提醒按参考偏离阈值和累计有效时间触发；此测试不改变监控条件或计时。';
    const id = Number(this.db.prepare("INSERT INTO spread_notices(direction_id,title,body,status,created_at) VALUES (?,?,?,'pending',?)").run('test', title, body, new Date(this.now()).toISOString()).lastInsertRowid);
    let status: 'sent' | 'failed' | 'unknown' = 'unknown';
    this.sendQueue = this.sendQueue.then(async () => {
      try { status = this.stopped ? 'failed' : await (this.options.send ?? sendSpreadBark)(title, body); } catch { /* 请求结果不确定时不自动重发。 */ }
      this.db.prepare('UPDATE spread_notices SET status = ? WHERE id = ?').run(status, id);
    });
    await this.sendQueue;
    return { status };
  }
  private notify(row: SpreadDirection) {
    const title = `${row.asset} 价差条件达标`;
    const signed = (value: number | null) => value === null ? '无法足额估算（深度不足）' : `${value >= 0 ? '+' : ''}${value.toFixed(2)} BPS`;
    const body = `${row.buyVenue} 买入 → ${row.sellVenue} 卖出\n参考偏离 ${signed(row.deviationBps)}（阈值 ${this.settings.thresholdBps} BPS）\n市价偏离 ${signed(row.spreadBps !== null && row.meanBps !== null ? row.spreadBps - row.meanBps : null)}；原始市价价差 ${signed(row.spreadBps)}\n${this.settings.historyDays}天均值 ${signed(row.meanBps)}；历史覆盖 ${(row.coverage * 100).toFixed(0)}%\n单边 $${this.settings.amountUsd}；估算容量 ${row.capacity ? `$${Number(row.capacity.amountUsd).toFixed(2)}${row.capacity.depthLimited ? '（已知盘口上限）' : ''}` : '不可用'}\n累计 ${row.elapsedSeconds} / ${this.settings.durationSeconds} 秒；仅参考偏离触发，未扣手续费及资金费。`;
    const id = this.db.transaction(() => {
      this.db.prepare('INSERT INTO spread_episodes VALUES (?, 1, ?, ?) ON CONFLICT(direction_id) DO UPDATE SET notified = 1, amount_usd = excluded.amount_usd, recovery_bps = excluded.recovery_bps').run(row.id, this.settings.amountUsd, row.meanBps! + this.settings.thresholdBps);
      return Number(this.db.prepare("INSERT INTO spread_notices(direction_id,title,body,status,created_at) VALUES (?,?,?,'pending',?)").run(row.id, title, body, new Date(this.now()).toISOString()).lastInsertRowid);
    })();
    this.notified.add(row.id);
    this.recovery.set(row.id, { amount: this.settings.amountUsd, spread: row.meanBps! + this.settings.thresholdBps });
    this.sendQueue = this.sendQueue.then(async () => {
      if (this.stopped || !this.settings.notificationsEnabled) { this.db.prepare("UPDATE spread_notices SET status = 'failed' WHERE id = ?").run(id); return; }
      const status = await (this.options.send ?? sendSpreadBark)(title, body);
      this.db.prepare('UPDATE spread_notices SET status = ? WHERE id = ?').run(status, id);
    }).catch(() => { /* 进程退出前由 stop 等待队列；pending 启动后标记 unknown */ });
  }
  snapshot(): SpreadSnapshot {
    const selected = this.selected(); const symbols = [...new Set(selected.flatMap(a => a.legs.map(l => l.symbol)))];
    return { marketCapStatus: { unknownAssets: this.assets.filter(a => a.venues.filter(v => this.settings.venues.includes(v.venue as SpreadSettings['venues'][number])).length >= 2 && this.marketCaps.get(a.asset) === null).length, error: this.marketCaps.error }, settings: this.settings, barkConfigured: this.configured(), rows: this.rows, updatedAt: new Date(this.lastTick || this.now()).toISOString(), coverage: { assets: selected.length, symbols: symbols.length, validSymbols: symbols.filter(s => { const b = this.feed.book(s); return b && this.now() - Date.parse(b.updatedAt) <= 5000; }).length, connections: this.feed.connections, error: this.error ?? this.feed.error ?? null } };
  }
  detail(id: string, amount: number) {
    const row = this.rows.find(r => r.id === id); if (!row) return null;
    const buy = this.feed.book(row.buySymbol); const sell = this.feed.book(row.sellSymbol);
    if (!buy || !sell || Date.parse(buy.updatedAt) > this.now() + 1000 || Date.parse(sell.updatedAt) > this.now() + 1000 || this.now() - Date.parse(buy.updatedAt) > 5000 || this.now() - Date.parse(sell.updatedAt) > 5000 || Math.abs(Date.parse(buy.updatedAt) - Date.parse(sell.updatedAt)) > 2000) return { row, estimate: null, capacity: null };
    if (Number(buy.bids[0]?.[0]) > Number(buy.asks[0]?.[0]) || Number(sell.bids[0]?.[0]) > Number(sell.asks[0]?.[0])) return { row, estimate: null, capacity: null };
    const asks = normalizeSpreadLevels(buy.asks, 'asks'); const bids = normalizeSpreadLevels(sell.bids, 'bids');
    return { row, estimate: estimateSpreadAmount(asks, bids, amount), capacity: row.meanBps === null ? null : spreadCapacity(asks, bids, row.meanBps + this.settings.thresholdBps) };
  }
  historyPoints(id: string, minutes: number, before: number, _amount: number): SpreadHistoryPoint[] {
    void _amount; // 保留旧 API 参数；K 线基准与成交金额无关。
    const [buy, sell] = id.split('~');
    const points = this.reference.read(buy, sell, this.settings.historyDays).points;
    const groups = new Map<number, { total: number; count: number }>();
    const interval = Math.max(60, minutes) * 60000;
    for (const p of points) {
      const time = Math.floor(p.time / interval) * interval;
      if (time >= before) continue;
      const group = groups.get(time) ?? { total: 0, count: 0 };
      group.total += p.value; group.count++; groups.set(time, group);
    }
    return [...groups].map(([time, g]) => ({ time, value: g.total / g.count, count: g.count })).sort((a, b) => a.time - b.time).slice(-500);
  }
  notices(): SpreadNotice[] { return this.db.prepare('SELECT id, direction_id AS directionId, title, body, status, created_at AS createdAt FROM spread_notices ORDER BY id DESC LIMIT 100').all() as SpreadNotice[]; }
  flush() {
    if (this.now() - this.cleanupAt > 3600000) {
      this.cleanupAt = this.now(); this.db.prepare('DELETE FROM spread_notices WHERE created_at < ?').run(new Date(this.now() - 30 * DAY).toISOString());
    }
  }
  async stop() { this.stopped = true; this.reference.stop(); this.marketCaps.stop(); if (this.timer) clearInterval(this.timer); if (this.refreshTimer) clearInterval(this.refreshTimer); if (this.flushTimer) clearInterval(this.flushTimer); this.feed.stop(); await Promise.all([this.refreshPending, this.capsPending]); this.flush(); await this.sendQueue; }
}
