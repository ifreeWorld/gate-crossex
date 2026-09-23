import type { Candle, SpreadHistoryPoint } from '@gate-crossex/shared-types';

const HOUR = 3600000;
const RETENTION = 30 * 24 * HOUR;
export type SpreadCandleLoader = (symbol: string, limit: number, before?: number) => Promise<Candle[]>;
type Entry = { prices: Map<number, number>; next: number; pending: boolean; error: string | null; requestedHours: number };
/** 每个合约只请求一次，方向间共享；最多保存三十天已收盘小时线，不写数据库。 */
export class SpreadReference {
  private entries = new Map<string, Entry>();
  private queue: string[] = [];
  private running = 0;
  private stopped = false;
  private days = 7;
  private symbols: string[] = [];
  constructor(private load: SpreadCandleLoader, private now: () => number = Date.now) {}
  ensure(symbols: string[], days = 7) {
    if (this.stopped) return;
    this.days = days; this.symbols = symbols;
    const wanted = new Set(symbols);
    for (const [symbol, entry] of this.entries) if (!wanted.has(symbol) && !entry.pending) this.entries.delete(symbol);
    for (const symbol of wanted) {
      let entry = this.entries.get(symbol);
      if (!entry) { entry = { prices: new Map(), next: 0, pending: false, error: null, requestedHours: 0 }; this.entries.set(symbol, entry); }
      if (!entry.pending && (entry.next <= this.now() || days * 24 > entry.requestedHours)) { entry.pending = true; this.queue.push(symbol); }
    }
    this.pump();
  }
  private pump() {
    while (!this.stopped && this.running < 4 && this.queue.length) {
      const symbol = this.queue.shift()!; const entry = this.entries.get(symbol)!;
      this.running++;
      void this.update(symbol, entry).finally(() => { this.running--; entry.pending = false; this.ensure(this.symbols, this.days); });
    }
  }
  private async update(symbol: string, entry: Entry) {
    try {
      const now = this.now(); const end = Math.floor(now / HOUR) * HOUR;
      const hours = this.days * 24;
      const full = entry.requestedHours < hours || [...entry.prices.keys()].filter(t => t >= end - hours * HOUR).length < Math.ceil(hours * .9);
      entry.requestedHours = hours;
      const latest = Math.max(-Infinity, ...entry.prices.keys());
      const limit = full ? Math.min(300, hours + 1) : Math.min(300, Math.max(2, Math.ceil((end - latest) / HOUR) + 1));
      let before: number | undefined;
      // 上游单次数量有限，按最早时间向前翻页，不把不足一页误判为完整窗口。
      for (let page = 0; page < Math.ceil(hours / 100) + 2; page++) {
        const candles = await this.load(symbol, limit, before);
        if (this.stopped) return;
        const times = candles.map(c => c.startTime).filter(t => Number.isFinite(t) && t < (before ?? end));
        for (const c of candles) {
          const price = Number(c.close);
          if (c.closed && c.startTime % HOUR === 0 && c.startTime < end && c.startTime >= end - RETENTION && Number.isFinite(price) && price > 0) entry.prices.set(c.startTime, price);
        }
        const earliest = Math.min(...times);
        if (!full || !Number.isFinite(earliest) || earliest <= end - hours * HOUR) break;
        before = earliest;
      }
      for (const time of entry.prices.keys()) if (time < end - RETENTION) entry.prices.delete(time);
      const fresh = entry.prices.has(end - HOUR);
      entry.error = fresh ? null : '最新已收盘 K 线尚未返回';
      entry.next = fresh ? end + HOUR + 15000 : now + 60000;
    } catch { entry.error = '历史 K 线获取失败，正在重试'; entry.next = this.now() + 60000; }
  }
  read(buy: string, sell: string, days = this.days) {
    const hours = days * 24;
    const b = this.entries.get(buy); const s = this.entries.get(sell);
    const end = Math.floor(this.now() / HOUR) * HOUR;
    const points: SpreadHistoryPoint[] = [];
    for (const [time, price] of b?.prices ?? []) {
      const other = s?.prices.get(time);
      if (other && time >= end - hours * HOUR && time < end) points.push({ time, value: (other / price - 1) * 10000, count: 1 });
    }
    points.sort((a, b) => a.time - b.time);
    const coverage = points.length / hours;
    const fresh = points.at(-1)?.time === end - HOUR;
    return { points, mean: points.length ? points.reduce((sum, p) => sum + p.value, 0) / points.length : null, coverage, hours: points.length,
      sufficient: coverage >= .9 && fresh,
      reason: b?.error ?? s?.error ?? (!fresh ? `正在加载最近 ${days} 天 K 线` : coverage < .9 ? `${days} 天 K 线覆盖不足：${points.length} / ${hours} 小时` : null) };
  }
  stop() { this.stopped = true; this.queue = []; }
}
