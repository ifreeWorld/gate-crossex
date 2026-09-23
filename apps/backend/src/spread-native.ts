import { z } from 'zod';

export function nativeChannel(symbol: string): string | null {
  const [venue, , , quote] = symbol.split('_');
  if (venue === 'GATE') return `gate_${quote.toLowerCase()}`;
  if (venue === 'BINANCE') return 'binance_book';
  if (venue === 'OKX') return 'okx_book';
  if (venue === 'HYPERLIQUID') return 'hyperliquid_book';
  if (venue === 'BYBIT') return 'bybit_book';
  return null;
}
export function nativeUrl(channel: string): string | null {
  if (channel.startsWith('gate_')) return `wss://fx-ws.gateio.ws/v4/ws/${channel.slice(5)}`;
  return ({ hyperliquid_book: 'wss://api.hyperliquid.xyz/ws', binance_book: 'wss://fstream.binance.com/public/ws', okx_book: 'wss://ws.okx.com:8443/ws/v5/public', bybit_book: 'wss://stream.bybit.com/v5/public/linear' } as Record<string, string>)[channel] ?? null;
}
export function nativePair(symbol: string): string {
  const [venue, , base, quote] = symbol.split('_');
  return venue === 'GATE' ? `${base}_${quote}` : venue === 'OKX' ? `${base}-${quote}-SWAP` : `${base}${quote}`;
}
export function nativeSubscriptions(channel: string, event: string, symbols: string[], pairFor: (symbol: string) => string = nativePair): object[] {
  // 默认 20 档是慢速推送；监控使用快速 5 档，避免与 5 秒时效门槛冲突。
  if (channel === 'hyperliquid_book') return symbols.map(symbol => ({ method: event, subscription: { type: 'l2Book', coin: pairFor(symbol), fast: true } }));
  const time = Math.floor(Date.now() / 1000);
  if (channel.startsWith('gate_')) return symbols.map(s => ({ time, channel: 'futures.order_book', event, payload: [nativePair(s), '100', '0'] }));
  const messages: object[] = [];
  for (let i = 0; i < symbols.length; i += 10) {
    const batch = symbols.slice(i, i + 10);
    if (channel === 'binance_book') messages.push({ method: event.toUpperCase(), params: batch.map(s => `${nativePair(s).toLowerCase()}@depth20@500ms`), id: i + 1 });
    if (channel === 'okx_book') messages.push({ op: event, args: batch.map(s => ({ channel: 'books5', instId: nativePair(s) })) });
    if (channel === 'bybit_book') messages.push({ op: event, args: batch.map(s => `orderbook.50.${nativePair(s)}`) });
  }
  return messages;
}
const pair = z.tuple([z.string(), z.string()]);
const gateLevel = z.object({ p: z.string(), s: z.union([z.string(), z.number().finite()]) });
const gateBook = z.object({ t: z.number().finite(), contract: z.string(), asks: z.array(gateLevel), bids: z.array(gateLevel) });
const binanceBook = z.object({ s: z.string(), E: z.number().finite(), a: z.array(pair), b: z.array(pair) });
const bybitBook = z.object({ ts: z.number().finite(), type: z.enum(['snapshot', 'delta']), data: z.object({ s: z.string(), u: z.number().int().positive().refine(Number.isSafeInteger), a: z.array(pair), b: z.array(pair) }) });
const hyperliquidLevel = z.object({ px: z.string(), sz: z.string() });
const hyperliquidBook = z.object({ coin: z.string(), time: z.number().finite(), levels: z.tuple([z.array(hyperliquidLevel), z.array(hyperliquidLevel)]) });
const okxBook = z.object({ ts: z.string(), asks: z.array(z.array(z.string()).min(2)), bids: z.array(z.array(z.string()).min(2)) });

// Bybit 50 档区分快照和增量；其他原生频道使用完整限档快照。
export function decodeNativeBook(channel: string, message: unknown, lookup: (pair: string) => string | undefined) {
  const envelope = z.object({ event: z.string().optional(), channel: z.string().optional(), e: z.string().optional(), topic: z.string().optional(), result: z.unknown().optional(), arg: z.object({ channel: z.string(), instId: z.string() }).optional(), data: z.unknown().optional() }).parse(message);
  if (channel === 'hyperliquid_book' && envelope.channel === 'l2Book') { const book = hyperliquidBook.parse(envelope.data); return { s: lookup(book.coin), ts: book.time, b: book.levels[0].map(l => [l.px, l.sz]), a: book.levels[1].map(l => [l.px, l.sz]) }; }
  if (channel.startsWith('gate_') && envelope.channel === 'futures.order_book' && envelope.event === 'all') {
    const book = gateBook.parse(envelope.result);
    return { s: lookup(book.contract), ts: book.t, a: book.asks.map(l => [l.p, String(l.s)]), b: book.bids.map(l => [l.p, String(l.s)]) };
  }
  if (channel === 'binance_book' && envelope.e === 'depthUpdate') { const book = binanceBook.parse(message); return { ...book, s: lookup(book.s), ts: book.E }; }
  if (channel === 'bybit_book' && envelope.topic?.startsWith('orderbook.50.')) { const book = bybitBook.parse(message); return { ...book.data, s: lookup(book.data.s), ts: book.ts, snapshot: book.type === 'snapshot' || book.data.u === 1 }; }
  if (channel === 'okx_book' && envelope.arg?.channel === 'books5' && envelope.data) {
    const book = z.array(okxBook).min(1).parse(envelope.data)[0];
    return { s: lookup(envelope.arg.instId), ts: Number(book.ts), a: book.asks.map(l => l.slice(0, 2)), b: book.bids.map(l => l.slice(0, 2)) };
  }
  return null;
}

/** 仅完整快照可合并处理；Bybit、Kraken 增量始终逐条应用。 */
export function nativeMessagePair(channel: string, message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  const nested = (object: unknown, key: string) => object && typeof object === 'object' ? (object as Record<string, unknown>)[key] : undefined;
  const pair = channel === 'hyperliquid_book' ? nested(msg.data, 'coin') : channel.startsWith('gate_') ? nested(msg.result, 'contract') : channel === 'okx_book' ? nested(msg.arg, 'instId') : channel === 'bybit_book' ? nested(msg.data, 's') : msg.s;
  return typeof pair === 'string' ? pair : null;
}
