import WebSocket from 'ws';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { nativeChannel, nativeUrl, nativeSubscriptions, decodeNativeBook, nativePair, nativeMessagePair } from './spread-native.js';
import type { OrderBookSnapshot } from '@gate-crossex/shared-types';

type Trace = { requestedAt: number | null; acknowledgedAt: number | null; receivedAt: number | null; appliedAt: number | null };
type Subscription = { message: string; symbols: string[]; event: string };
type Book = { bids: Map<string, string>; asks: Map<string, string>; at: number; sequence: bigint | null; source?: OrderBookSnapshot['source']; cached?: OrderBookSnapshot };
type Group = { socket: WebSocket | null; retry: ReturnType<typeof setTimeout> | null; heartbeat: ReturnType<typeof setInterval> | null; symbols: Set<string>; attempt: number; channel: string; queue: Subscription[]; routes: Map<string, string>; sender: ReturnType<typeof setInterval> | null };
const sequence = z.union([z.string().regex(/^-?\d+$/), z.number().int().refine(Number.isSafeInteger)]);
const level = z.tuple([z.string().refine(v => Number.isFinite(Number(v)) && Number(v) > 0), z.string().refine(v => Number.isFinite(Number(v)) && Number(v) >= 0)]);
const Update = z.object({ s: z.string(), ts: z.number().finite(), snapshot: z.boolean().optional(), U: sequence.optional(), u: sequence.optional(), a: z.array(level), b: z.array(level) });

// 六家交易所直连原生公开盘口；Hyperliquid 合约名来自公开元数据。
// CrossEx 实测每 IP 5 条连接、每连接每频道 100 个交易对，不能承载全量目录。
function channelFor(symbol: string) {
  const native = nativeChannel(symbol); if (native) return native;
  return 'kraken_book';
}
function krakenProduct(symbol: string) {
  const [, , base, quote] = symbol.split('_');
  return `PF_${({ BTC: 'XBT', DOGE: 'XDG' } as Record<string, string>)[base] ?? base}${quote}`;
}
const nativeLevel = z.object({ price: z.number().finite().positive(), qty: z.number().finite().nonnegative() });
const KrakenSnapshot = z.object({ feed: z.literal('book_snapshot'), product_id: z.string(), timestamp: z.number().finite(), seq: sequence, asks: z.array(nativeLevel), bids: z.array(nativeLevel) });
const KrakenDelta = z.object({ feed: z.literal('book'), product_id: z.string(), timestamp: z.number().finite(), seq: sequence, side: z.enum(['buy', 'sell']), price: z.number().finite().positive(), qty: z.number().finite().nonnegative() });

export class SpreadFeed {
  private groups = new Set<Group>();
  private owners = new Map<string, Group>();
  private books = new Map<string, Book>();
  private errors = new Map<Group, string>();
  private stopped = false;
  private processedAt = new Map<string, number>();
  private wantedSymbols: string[] = [];
  private hyperliquidMarkets: Record<string, string> = {};
  private traces = new Map<string, Trace>();
  private units = new Map<string, string>();
  private okxRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private okxRefreshes = new Map<string, { attemptedAt: number; nextAt: number; receivedAt: number | null; error: string | null }>();
  private okxRequests = new Map<string, AbortController>();
  private okxPausedUntil = 0;
  constructor(private url: string, private krakenUrl = 'wss://futures.kraken.com/ws/v1', private nativeUrls: Record<string, string> = {}, private okxFetch: typeof fetch = fetch) {}

  // books5 按变化推送；只复核静默盘口，全实例最多 10 次/秒、8 个在途请求。
  private refreshSilentOkx() {
    const now = Date.now();
    if (this.stopped || now < this.okxPausedUntil || this.okxRequests.size >= 8) return;
    const candidate = [...this.owners].filter(([symbol, group]) => {
      const book = this.books.get(symbol);
      return group.channel === 'okx_book' && group.socket?.readyState === WebSocket.OPEN && book && now - book.at >= 1500 && !this.okxRequests.has(symbol) && now >= (this.okxRefreshes.get(symbol)?.nextAt ?? 0);
    }).sort(([a], [b]) => (this.books.get(a)?.at ?? 0) - (this.books.get(b)?.at ?? 0) || (this.okxRefreshes.get(a)?.attemptedAt ?? 0) - (this.okxRefreshes.get(b)?.attemptedAt ?? 0))[0];
    if (!candidate) return;
    const [symbol, group] = candidate;
    const socket = group.socket;
    const trace = this.traces.get(symbol);
    const controller = new AbortController();
    this.okxRequests.set(symbol, controller);
    const state = { attemptedAt: now, nextAt: now + 1500, receivedAt: null as number | null, error: null as string | null };
    this.okxRefreshes.set(symbol, state);
    const current = () => !this.stopped && !controller.signal.aborted && this.owners.get(symbol) === group && group.socket === socket && socket?.readyState === WebSocket.OPEN && this.traces.get(symbol) === trace;
    void (async () => {
      try {
        const response = await this.okxFetch(`https://www.okx.com/api/v5/market/books?instId=${encodeURIComponent(nativePair(symbol))}&sz=5`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]) });
        if (!current()) return;
        if (response.status === 429) this.okxPausedUntil = Date.now() + 10000;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = z.object({ code: z.string(), data: z.unknown().optional() }).parse(await response.json());
        if (!current()) return;
        if (payload.code === '50011') this.okxPausedUntil = Date.now() + 10000;
        if (payload.code !== '0') throw new Error(`OKX ${payload.code}`);
        const r = Update.parse(decodeNativeBook('okx_book', { arg: { channel: 'books5', instId: nativePair(symbol) }, data: payload.data }, () => symbol));
        const receivedAt = Date.now();
        if (r.ts <= 0 || r.ts > receivedAt + 1000 || receivedAt - r.ts > 5000) throw new Error('REST 盘口源时间过期或异常');
        if (!r.a.length || !r.b.length || Number(r.b[0][0]) > Number(r.a[0][0])) throw new Error('REST 盘口无效');
        state.receivedAt = receivedAt;
        const book = this.books.get(symbol);
        // WS 可能已更新；REST 不能覆盖较新的盘口，也不能刷新旧快照时间。
        if (!book || r.ts <= book.at) return;
        this.books.set(symbol, { asks: new Map(r.a.filter(([, q]) => Number(q) > 0)), bids: new Map(r.b.filter(([, q]) => Number(q) > 0)), at: r.ts, sequence: null, source: 'venue_public_rest' });
      } catch (error) {
        if (!current()) return;
        state.error = error instanceof Error ? error.message.slice(0, 160) : 'REST 复核失败';
        state.nextAt = Date.now() + 5000;
      } finally {
        if (this.okxRequests.get(symbol) === controller) this.okxRequests.delete(symbol);
      }
    })();
  }
  private cancelOkxRefresh(symbol: string) {
    this.okxRequests.get(symbol)?.abort(); this.okxRequests.delete(symbol); this.okxRefreshes.delete(symbol);
  }

  setHyperliquidMarkets(markets: Record<string, string>) {
    if (this.stopped) return;
    const changed = [...this.owners.keys()].some(s => s.startsWith('HYPERLIQUID_') && this.hyperliquidMarkets[s] !== markets[s]);
    if (changed) {
      // 映射改变时丢弃旧来源盘口并重建该交易所连接，不能拼接不同 dex 数据。
      for (const group of [...this.groups]) if (group.channel === 'hyperliquid_book') {
        for (const s of group.symbols) { this.owners.delete(s); this.books.delete(s); this.traces.delete(s); this.processedAt.delete(s); }
        this.remove(group);
      }
    }
    this.hyperliquidMarkets = { ...markets };
    this.setSymbols(this.wantedSymbols);
  }
  marketName(symbol: string) { return this.hyperliquidMarkets[symbol]; }
  private pairFor(symbol: string) { return this.hyperliquidMarkets[symbol] ?? nativePair(symbol); }

  setContractSizes(venue: 'GATE' | 'OKX', sizes: Array<{ base: string; quote: string; multiplier: string }>) {
    for (const symbol of this.units.keys()) if (symbol.startsWith(`${venue}_`)) this.units.delete(symbol);
    for (const size of sizes) if (Number.isFinite(Number(size.multiplier)) && Number(size.multiplier) > 0) this.units.set(`${venue}_FUTURE_${size.base}_${size.quote}`, size.multiplier);
    for (const [symbol, book] of this.books) if (symbol.startsWith(`${venue}_`)) book.cached = undefined;
  }

  setSymbols(symbols: string[]) {
    if (this.stopped) return;
    this.wantedSymbols = [...new Set(symbols)];
    const wanted = new Set(this.wantedSymbols.filter(s => !s.startsWith('HYPERLIQUID_') || this.hyperliquidMarkets[s]));
    for (const group of this.groups) {
      const removed = [...group.symbols].filter(s => !wanted.has(s));
      for (const s of removed) { this.cancelOkxRefresh(s); group.symbols.delete(s); this.owners.delete(s); this.books.delete(s); this.processedAt.delete(s); this.traces.delete(s); group.routes.delete(this.pairFor(s)); }
      if (!group.symbols.size) { this.remove(group); continue; }
      if (removed.length && group.socket?.readyState === WebSocket.OPEN) this.send(group, 'unsubscribe', removed);
    }
    let delay = 0;
    for (const symbol of wanted) {
      if (this.owners.has(symbol)) continue;
      const channel = channelFor(symbol);
      let group = [...this.groups].find(g => g.channel === channel && g.symbols.size < 100);
      if (!group) {
        group = { socket: null, retry: null, heartbeat: null, symbols: new Set(), attempt: 0, channel, queue: [], routes: new Map(), sender: null };
        this.groups.add(group);
        const next = group;
        group.retry = setTimeout(() => this.connect(next), delay); group.retry.unref?.(); delay += 500;
      }
      this.traces.set(symbol, { requestedAt: null, acknowledgedAt: null, receivedAt: null, appliedAt: null });
      group.symbols.add(symbol); group.routes.set(this.pairFor(symbol), symbol); this.owners.set(symbol, group);
      if (group.socket?.readyState === WebSocket.OPEN) this.send(group, 'subscribe', [symbol]);
    }
    if ([...this.owners.values()].some(g => g.channel === 'okx_book')) {
      this.okxRefreshTimer ??= setInterval(() => this.refreshSilentOkx(), 100);
      this.okxRefreshTimer.unref?.();
    } else if (this.okxRefreshTimer) { clearInterval(this.okxRefreshTimer); this.okxRefreshTimer = null; }
  }
  private send(group: Group, event: string, symbols: string[]) {
    if (nativeUrl(group.channel)) { group.queue.push(...nativeSubscriptions(group.channel, event, symbols, s => this.pairFor(s)).map((message, index) => ({ message: JSON.stringify(message), event, symbols: (group.channel.startsWith('gate_') || group.channel === 'hyperliquid_book') ? symbols.slice(index, index + 1) : symbols.slice(index * 10, index * 10 + 10) }))); return; }
    // CrossEx 每连接每频道至多 100 个交易对；原生频道独立分组。
    for (let offset = 0; offset < symbols.length; offset += 80) {
      const batch = symbols.slice(offset, offset + 80);
      if (event === 'subscribe') this.markRequested(batch);
      if (group.channel === 'kraken_book') group.socket?.send(JSON.stringify({ event, feed: 'book', product_ids: batch.map(krakenProduct) }));
      else group.socket?.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: group.channel, event, payload: batch }));
    }
  }
  private markRequested(symbols: string[]) {
    for (const symbol of symbols) { const trace = this.traces.get(symbol); if (trace) { trace.requestedAt = Date.now(); trace.acknowledgedAt = null; } }
  }
  private remove(group: Group) {
    this.groups.delete(group); this.errors.delete(group);
    if (group.retry) clearTimeout(group.retry);
    if (group.heartbeat) clearInterval(group.heartbeat);
    if (group.sender) clearInterval(group.sender);
    group.queue = [];
    group.socket?.terminate();
  }
  private clearBooks(group: Group) {
    for (const symbol of group.symbols) if (this.owners.get(symbol) === group) { this.books.delete(symbol); this.cancelOkxRefresh(symbol); }
  }
  private connect(group: Group) {
    if (!this.groups.has(group) || this.stopped) return;
    const socket = new WebSocket(this.nativeUrls[group.channel] ?? nativeUrl(group.channel) ?? (group.channel === 'kraken_book' ? this.krakenUrl : this.url), { handshakeTimeout: 15000, headers: { 'X-Gate-Size-Decimal': '1' } });
    group.socket = socket; group.retry = null;
    let alive = true;
    const pending = new Map<string, { data: { toString(): string }; receivedAt: number; timer: ReturnType<typeof setTimeout> }>();
    socket.on('open', () => {
      group.sender = setInterval(() => { if (socket.readyState !== WebSocket.OPEN) return; const entry = group.queue.shift(); if (entry) { if (entry.event === 'subscribe') this.markRequested(entry.symbols); socket.send(entry.message); } }, 250);
      group.sender.unref?.();
      this.send(group, 'subscribe', [...group.symbols]);
      group.heartbeat = setInterval(() => {
        if (!alive) { socket.terminate(); return; }
        alive = false; socket.ping();
        if (group.channel === 'okx_book') socket.send('ping');
        if (group.channel === 'hyperliquid_book') socket.send(JSON.stringify({ method: 'ping' }));
        if (group.channel === 'bybit_book') socket.send(JSON.stringify({ op: 'ping' }));
      }, 25000);
      group.heartbeat.unref?.();
    });
    socket.on('pong', () => { alive = true; });
    const handleMessage = (raw: { toString(): string }, receivedAt = Date.now()) => {
      if (group.socket !== socket || !this.groups.has(group)) return;
      try {
        if (raw.toString() === 'pong') { alive = true; return; }
        let msg = JSON.parse(raw.toString());
        if (group.channel === 'hyperliquid_book' && msg.channel === 'pong') { alive = true; return; }
        if (group.channel === 'hyperliquid_book' && msg.channel === 'subscriptionResponse' && msg.data?.method === 'subscribe') { const symbol = group.routes.get(msg.data.subscription?.coin); const trace = symbol ? this.traces.get(symbol) : undefined; if (trace) trace.acknowledgedAt = receivedAt; return; }
        if (msg.channel === 'error' || msg.error || msg.event === 'error' || msg.event === 'subscribed_failed' || msg.success === false || (msg.code !== undefined && msg.code !== 0 && msg.code !== '0')) { this.errors.set(group, `${group.channel} ${[...group.symbols][0]}：${String(msg.error?.message ?? msg.message ?? msg.msg ?? msg.ret_msg ?? (typeof msg.data === 'string' ? msg.data : '订阅被拒绝')).slice(0,500)}`); this.clearBooks(group); socket.terminate(); return; }
        // 仅在响应明确关联到交易对时记录确认；确认不等于收到首帧。
        if (msg.event === 'subscribe' || msg.event === 'subscribed') {
          let acknowledged: string[] = [];
          if (group.channel.startsWith('gate_') && msg.result?.status === 'success') acknowledged = [group.routes.get(msg.payload?.[0])].filter((s): s is string => !!s);
          else if (group.channel === 'okx_book' && msg.arg?.instId) acknowledged = [group.routes.get(msg.arg.instId)].filter((s): s is string => !!s);
          else if (group.channel === 'order_book_20' && msg.result?.status === 'success' && Array.isArray(msg.payload)) acknowledged = msg.payload;
          else if (group.channel === 'kraken_book' && Array.isArray(msg.product_ids)) acknowledged = [...group.symbols].filter(s => msg.product_ids.includes(krakenProduct(s)));
          for (const symbol of acknowledged) { const trace = this.traces.get(symbol); if (trace) trace.acknowledgedAt = receivedAt; }
        }
        if (nativeUrl(group.channel)) {
          const pair = nativeMessagePair(group.channel, msg);
          const symbol = pair ? group.routes.get(pair) : undefined;
          // 监控每秒计算一次；完整快照至多处理两次/秒，避免重复校验数万档盘口。
          if (group.channel !== 'bybit_book' && symbol && this.books.has(symbol)) {
            const remaining = 500 - (Date.now() - (this.processedAt.get(symbol) ?? 0));
            if (remaining > 0) {
              const existing = pending.get(symbol);
              if (existing) { existing.data = raw; existing.receivedAt = receivedAt; }
              else {
                const entry = { data: raw, receivedAt, timer: setTimeout(() => { pending.delete(symbol); handleMessage(entry.data, entry.receivedAt); }, remaining) };
                entry.timer.unref?.(); pending.set(symbol, entry);
              }
              return;
            }
            const existing = pending.get(symbol); if (existing) { clearTimeout(existing.timer); pending.delete(symbol); }
          }
          const result = decodeNativeBook(group.channel, msg, pair => group.routes.get(pair));
          if (!result || !result.s) return;
          msg = { channel: group.channel, event: 'update', result };
        }
        if (group.channel === 'kraken_book') {
          if (msg.event) return;
          if (msg.feed !== 'book_snapshot' && msg.feed !== 'book') return;
          const native = z.union([KrakenSnapshot, KrakenDelta]).parse(msg);
          const symbol = [...group.symbols].find(s => krakenProduct(s) === native.product_id);
          if (!symbol) return;
          const levels = (values: Array<{ price: number; qty: number }>) => values.map(v => [String(v.price), String(v.qty)]);
          const snapshot = native.feed === 'book_snapshot';
          msg = { channel: group.channel, event: 'update', result: { s: symbol, ts: native.timestamp, U: native.seq, u: native.seq, snapshot,
            a: snapshot ? levels(native.asks) : native.side === 'sell' ? levels([native]) : [],
            b: snapshot ? levels(native.bids) : native.side === 'buy' ? levels([native]) : [] } };
        }
        if (msg.channel !== group.channel || msg.event !== 'update') return;
        const parsed = Update.safeParse(msg.result);
        if (!parsed.success) { this.errors.set(group, '上游盘口格式异常，等待重新同步'); this.clearBooks(group); socket.terminate(); return; }
        const r = parsed.data;
        if (this.owners.get(r.s) !== group) return;
        let book = this.books.get(r.s);
        const u = r.u === undefined ? null : BigInt(r.u);
        const U = r.U === undefined ? null : BigInt(r.U);
        const snapshot = (group.channel !== 'kraken_book' && group.channel !== 'bybit_book') || r.snapshot === true;
        const end = u;
        if (snapshot) {
          if (book && r.ts < book.at) return;
          book = { bids: new Map(), asks: new Map(), at: r.ts, sequence: end };
        } else {
          if (!book) return;
          if (r.ts < book.at || (end !== null && book.sequence !== null && end <= book.sequence)) return;
          // Kraken 每条增量序号必须连续。
          const start = U;
          // Bybit 的 u 只用于去重和拒绝旧增量，不要求相邻消息连续；新快照重建盘口。
          if (group.channel === 'kraken_book' && (start === null || end === null || book.sequence === null || start > book.sequence + 1n || end < start)) {
            this.errors.set(group, '盘口断档，正在重新同步'); this.clearBooks(group); socket.terminate(); return;
          }
        }
        for (const [levels, updates] of [[book.asks, r.a], [book.bids, r.b]] as const) {
          for (const [price, quantity] of updates) {
            if (Number(quantity) === 0) levels.delete(price); else levels.set(price, quantity);
          }
        }
        const trace = this.traces.get(r.s); if (trace) { trace.receivedAt = receivedAt; trace.appliedAt = Date.now(); }
        book.at = r.ts; book.sequence = end; book.cached = undefined;
        this.books.set(r.s, book); this.processedAt.set(r.s, Date.now()); this.errors.delete(group); group.attempt = 0;
      } catch { this.errors.set(group, `${group.channel} 上游盘口不可解析`); this.clearBooks(group); socket.terminate(); }
    };
    socket.on('message', raw => handleMessage(raw, Date.now()));
    socket.on('error', (error) => { if (!this.groups.has(group) || group.socket !== socket) return; this.errors.set(group, `${group.channel} ${[...group.symbols][0]}：${error instanceof Error ? error.message.slice(0,160) : '连接失败'}，正在重试`); });
    socket.on('close', () => {
      for (const entry of pending.values()) clearTimeout(entry.timer); pending.clear();
      if (group.socket !== socket) return;
      if (group.heartbeat) clearInterval(group.heartbeat);
      group.heartbeat = null; group.socket = null;
      if (group.sender) clearInterval(group.sender); group.sender = null; group.queue = [];
      this.clearBooks(group);
      for (const symbol of group.symbols) this.traces.set(symbol, { requestedAt: null, acknowledgedAt: null, receivedAt: null, appliedAt: null });
      if (this.stopped || !this.groups.has(group)) return;
      group.retry = setTimeout(() => this.connect(group), Math.min(30000, 1000 * 2 ** Math.min(group.attempt++, 5)) + Math.random() * 500);
      group.retry.unref?.();
    });
  }
  book(symbol: string): OrderBookSnapshot | null {
    const b = this.books.get(symbol);
    if (!b) return null;
    const unit = /^(GATE|OKX)_/.test(symbol) ? this.units.get(symbol) : '1';
    if (!unit) return null;
    const convert = (levels: Map<string, string>): Array<[string, string]> => [...levels].map(([price, quantity]) => [price, new Decimal(quantity).mul(unit).toFixed()]);
    b.cached ??= { symbol, bids: convert(b.bids).sort((a, c) => Number(c[0]) - Number(a[0])), asks: convert(b.asks).sort((a, c) => Number(a[0]) - Number(c[0])), updatedAt: new Date(b.at).toISOString(), source: b.source ?? (symbol.startsWith('KRAKEN_') ? 'kraken_public_websocket' : nativeChannel(symbol) ? 'venue_public_websocket' : 'gate_crossex_websocket') };
    return b.cached;
  }
  private diagnose(symbol: string) {
    const group = this.owners.get(symbol);
    const trace = this.traces.get(symbol);
    const book = this.books.get(symbol);
    const state = symbol.startsWith('HYPERLIQUID_') && !this.hyperliquidMarkets[symbol] ? 'missing_market_mapping' : !group ? 'unsubscribed' : group.socket?.readyState !== WebSocket.OPEN ? 'connecting' : !trace?.requestedAt ? 'queued' : !book ? 'waiting_snapshot' : /^(GATE|OKX)_/.test(symbol) && !this.units.has(symbol) ? 'missing_contract_size' : 'ready';
    return { symbol, channel: group?.channel ?? null, state, requestedAt: trace?.requestedAt ?? null, acknowledgedAt: trace?.acknowledgedAt ?? null, receivedAt: trace?.receivedAt ?? null, appliedAt: trace?.appliedAt ?? null, sourceAt: book?.at ?? null, source: book?.source ?? (book ? 'venue_public_websocket' : null), restRefresh: this.okxRefreshes.get(symbol) ?? null, error: group ? this.errors.get(group) ?? null : null };
  }
  /** 时间戳分开记录；ready 只代表盘口已建好，不代表满足监控的时效要求。 */
  diagnostics() {
    return { at: Date.now(), groups: [...this.groups].map(g => ({ channel: g.channel, socketState: g.socket?.readyState ?? WebSocket.CLOSED, symbols: g.symbols.size, queuedMessages: g.queue.length, reconnectAttempt: g.attempt, error: this.errors.get(g) ?? null })), symbols: this.wantedSymbols.map(symbol => this.diagnose(symbol)) };
  }
  issue(symbol: string): string | null {
    const d = this.diagnose(symbol); const venue = symbol.split('_')[0];
    if (d.state === 'missing_market_mapping') return `${venue} 原生合约映射未就绪或存在同名歧义`;
    if (d.state === 'ready') return null;
    if (d.state === 'missing_contract_size') return `${venue} 已收到盘口，合约面值尚未获取`;
    if (d.state === 'connecting') return d.error ?? `${venue} 行情连接中，等待订阅`;
    if (d.state === 'queued') return `${venue} 等待发送盘口订阅`;
    if (d.state === 'waiting_snapshot') return `${venue} ${d.acknowledgedAt ? '订阅已确认，等待首帧' : '订阅已发送，等待首帧'}（${Math.max(0, Math.floor((Date.now() - d.requestedAt!) / 1000))} 秒）`;
    return `${venue} 尚未订阅盘口`;
  }
  get connections() { return this.groups.size; }
  get error() { return [...new Set(this.errors.values())].join('；') || null; }
  stop() { this.stopped = true; if (this.okxRefreshTimer) clearInterval(this.okxRefreshTimer); this.okxRefreshTimer = null; for (const symbol of this.okxRequests.keys()) this.cancelOkxRefresh(symbol); this.okxRefreshes.clear(); for (const group of this.groups) this.remove(group); this.owners.clear(); this.books.clear(); this.processedAt.clear(); this.traces.clear(); this.wantedSymbols = []; }
}
