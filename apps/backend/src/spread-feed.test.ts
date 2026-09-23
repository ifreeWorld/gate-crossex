import { afterEach, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { normalizeSpreadLevels, spreadCapacity } from '@gate-crossex/domain';
import { SpreadFeed } from './spread-feed.js';
import { nativeChannel, nativePair, nativeSubscriptions } from './spread-native.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function fixture(symbol: string, symbols = [symbol], okxFetch: typeof fetch = async () => { throw new Error('测试未配置 REST'); }) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('unexpected address');
  const url = `ws://127.0.0.1:${address.port}`;
  const feed = new SpreadFeed(url, url, { gate_usdt: url, binance_book: url, okx_book: url, bybit_book: url, hyperliquid_book: url }, okxFetch);
  feed.setHyperliquidMarkets(Object.fromEntries(symbols.filter(s => s.startsWith('HYPERLIQUID_')).map(s => [s, s.split('_')[2] === 'BTC' ? 'BTC' : `xyz:${s.split('_')[2]}`])));
  feed.setContractSizes('GATE', [{ base: 'BTC', quote: 'USDT', multiplier: '1' }]);
  feed.setContractSizes('OKX', [{ base: 'BTC', quote: 'USDT', multiplier: '1' }]);
  cleanup.push(async () => { feed.stop(); for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const connection = new Promise<WebSocket>(resolve => server.once('connection', resolve));
  feed.setSymbols(symbols);
  const socket = await connection;
  const received: Array<{ channel?: string; payload?: string[] }> = [];
  const raw = await new Promise<unknown>(resolve => socket.on('message', data => { received.push(JSON.parse(String(data))); resolve(data); }));
  const subscription = JSON.parse(String(raw));
  const send = (fields: Record<string, unknown>) => {
    const book = { s: symbol, ts: Date.now(), a: [['101', '5']], b: [['100', '5']], ...fields };
    const native = nativePair(symbol);
    let message: object = { channel: subscription.channel, event: 'update', result: book };
    if (symbol.startsWith('GATE_')) message = { channel: 'futures.order_book', event: 'all', result: { t: book.ts, contract: native, asks: book.a.map(([p, s]) => ({ p, s })), bids: book.b.map(([p, s]) => ({ p, s })) } };
    if (symbol.startsWith('BINANCE_')) message = { ...book, e: 'depthUpdate', s: native, E: book.ts };
    if (symbol.startsWith('OKX_')) message = { arg: { channel: 'books5', instId: native }, data: [{ ts: String(book.ts), asks: book.a, bids: book.b }] };
    if (symbol.startsWith('BYBIT_')) message = { ts: book.ts, type: 'snapshot', topic: `orderbook.50.${native}`, data: { u: 10, ...book, s: native } };
    if (symbol.startsWith('HYPERLIQUID_')) message = { channel: 'l2Book', data: { coin: symbol.split('_')[2] === 'BTC' ? 'BTC' : `xyz:${symbol.split('_')[2]}`, time: book.ts, levels: [book.b.map(([px, sz]) => ({ px, sz, n: 1 })), book.a.map(([px, sz]) => ({ px, sz, n: 1 }))] } };
    socket.send(JSON.stringify(message));
  };
  return { feed, socket, subscription, send, received, server };
}
it.each([['BINANCE_FUTURE_BTC_USDT', 'order_book_20'], ['OKX_FUTURE_BTC_USDT', 'order_book_5'], ['GATE_FUTURE_BTC_USDT', 'order_book_100'], ['BYBIT_FUTURE_BTC_USDT', 'order_book_50'], ['HYPERLIQUID_FUTURE_BTC_USDC', 'order_book_20']])('完整频道替换而非累计旧档位 %s', async (symbol, channel) => {
  const f = await fixture(symbol);
  const expected = nativeChannel(symbol) ? nativeSubscriptions(nativeChannel(symbol)!, 'subscribe', [symbol], s => s.startsWith('HYPERLIQUID_') ? 'BTC' : nativePair(s))[0] : { channel };
  expect(f.subscription).toMatchObject(symbol.startsWith('GATE_') ? { ...expected, time: expect.any(Number) } : expected);
  f.send({});
  await expect.poll(() => f.feed.book(symbol)?.asks).toEqual([['101', '5']]);
  await new Promise(resolve => setTimeout(resolve, 510));
  f.send({ a: [['102', '2']] });
  await expect.poll(() => f.feed.book(symbol)?.asks).toEqual([['102', '2']]);
  f.feed.setSymbols([]);
  expect(f.feed.book(symbol)).toBeNull();
  expect(f.feed.connections).toBe(0);
});
it('合约张数按面值转换，缺少面值不可计算', async () => {
  const symbol = 'OKX_FUTURE_BTC_USDT'; const f = await fixture(symbol);
  f.feed.setContractSizes('OKX', []); f.send({});
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(f.feed.book(symbol)).toBeNull();
  f.feed.setContractSizes('OKX', [{ base: 'BTC', quote: 'USDT', multiplier: '0.01' }]);
  expect(f.feed.book(symbol)?.asks).toEqual([['101', '0.05']]);
});
it('Kraken 原生快照与顺序增量；断档后丢弃盘口', async () => {
  const symbol = 'KRAKEN_FUTURE_BTC_USD'; const f = await fixture(symbol);
  expect(f.subscription).toEqual({ event: 'subscribe', feed: 'book', product_ids: ['PF_XBTUSD'] });
  f.socket.send(JSON.stringify({ event: 'subscribed', feed: 'book', product_ids: ['PF_XBTUSD'] }));
  const send = (fields: Record<string, unknown>) => f.socket.send(JSON.stringify({ product_id: 'PF_XBTUSD', timestamp: Date.now(), ...fields }));
  send({ feed: 'book', seq: 8, side: 'sell', price: 101, qty: 3 });
  await new Promise(resolve => setTimeout(resolve, 20)); expect(f.feed.book(symbol)).toBeNull();
  send({ feed: 'book_snapshot', seq: 10, asks: [{ price: 101, qty: 5 }], bids: [{ price: 100, qty: 5 }] });
  await expect.poll(() => f.feed.book(symbol)?.asks).toEqual([['101', '5']]);
  send({ feed: 'book', seq: 11, side: 'sell', price: 101, qty: 0 });
  await expect.poll(() => f.feed.book(symbol)?.asks).toEqual([]);
  send({ feed: 'book', seq: 13, side: 'sell', price: 102, qty: 2 });
  await expect.poll(() => f.feed.book(symbol)).toBeNull();
  expect(f.feed.error).toContain('断档');
});

it('Hyperliquid 原生按已确认映射订阅，每连接不超过 100 个', async () => {
  const feed = new SpreadFeed('ws://127.0.0.1:9');
  const symbols = Array.from({ length: 241 }, (_, i) => `HYPERLIQUID_FUTURE_TEST${i}_USDC`);
  feed.setSymbols(symbols);
  expect(feed.connections).toBe(0);
  feed.setHyperliquidMarkets(Object.fromEntries(symbols.map((s, i) => [s, `xyz:TEST${i}`])));
  expect(feed.connections).toBe(3);
  feed.setSymbols([...symbols, 'BINANCE_FUTURE_BTC_USDT']);
  expect(feed.connections).toBe(4);
  feed.stop();
});

it('高频完整快照合并后仍应用最后一帧，不依赖下一条行情到达', async () => {
  const symbol = 'BINANCE_FUTURE_BTC_USDT'; const f = await fixture(symbol);
  f.send({}); await expect.poll(() => f.feed.book(symbol)?.asks).toEqual([['101', '5']]);
  f.send({ a: [['102', '3']] }); f.send({ a: [['103', '2']] });
  await expect.poll(() => f.feed.book(symbol)?.asks).toEqual([['103', '2']]);
});


it('Bybit 50 档逐条合并高频增量，容量使用深层挂单，并支持快照重置', async () => {
  const symbol = 'BYBIT_FUTURE_BTC_USDT'; const f = await fixture(symbol);
  expect(f.subscription).toEqual({ op: 'subscribe', args: ['orderbook.50.BTCUSDT'] });
  expect(nativeSubscriptions('bybit_book', 'unsubscribe', [symbol])).toEqual([{ op: 'unsubscribe', args: ['orderbook.50.BTCUSDT'] }]);
  const ts = Date.now();
  const send = (type: string, u: number, a: string[][], b: string[][] = []) => f.socket.send(JSON.stringify({
    topic: 'orderbook.50.BTCUSDT', type, ts, data: { s: 'BTCUSDT', u, a, b },
  }));
  send('delta', 8, [['100', '1']]);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(f.feed.book(symbol)).toBeNull();
  send('snapshot', 10, [['100', '1'], ['101', '2']], [['99', '5']]);
  await expect.poll(() => f.feed.book(symbol)?.asks).toEqual([['100', '1'], ['101', '2']]);
  // 同一时刻连续消息必须全部应用，u 不保证逐一递增。
  send('delta', 12, [['100', '3']]);
  send('delta', 15, [['101', '0'], ['102', '4']]);
  send('delta', 18, [['103', '5']], [['99', '0'], ['98', '6']]);
  await expect.poll(() => f.feed.book(symbol)?.asks).toEqual([['100', '3'], ['102', '4'], ['103', '5']]);
  expect(f.feed.book(symbol)?.bids).toEqual([['98', '6']]);
  const asks = normalizeSpreadLevels(f.feed.book(symbol)!.asks, 'asks');
  expect(spreadCapacity(asks, [['104', '12']], 0)).toEqual({ amountUsd: '1223', quantity: '12', depthLimited: true });
  send('delta', 18, [['100', '99']]);
  send('delta', 16, [['100', '99']]);
  send('delta', 20, [['104', '1']]);
  await expect.poll(() => f.feed.book(symbol)?.asks).toHaveLength(4);
  expect(f.feed.book(symbol)?.asks[0]).toEqual(['100', '3']);
  send('snapshot', 1, [['105', '2']], [['104', '3']]);
  await expect.poll(() => f.feed.book(symbol)?.asks).toEqual([['105', '2']]);
  expect(f.feed.book(symbol)?.bids).toEqual([['104', '3']]);
  send('delta', 2, [['105', '4']]);
  await expect.poll(() => f.feed.book(symbol)?.asks).toEqual([['105', '4']]);
  f.socket.close();
  await expect.poll(() => f.feed.book(symbol)).toBeNull();
});

it('订阅确认不代表盘口就绪，诊断区分等待首帧与缺少合约面值', async () => {
  const symbol = 'GATE_FUTURE_BTC_USDT'; const f = await fixture(symbol);
  expect(f.feed.diagnostics().symbols[0]).toMatchObject({ symbol, state: 'waiting_snapshot', receivedAt: null });
  f.socket.send(JSON.stringify({ channel: 'futures.order_book', event: 'subscribe', payload: ['BTC_USDT', '100', '0'], result: { status: 'success' } }));
  await expect.poll(() => f.feed.diagnostics().symbols[0]?.acknowledgedAt).not.toBeNull();
  expect(f.feed.issue(symbol)).toContain('订阅已确认，等待首帧');
  f.feed.setContractSizes('GATE', []); f.send({});
  await expect.poll(() => f.feed.diagnostics().symbols[0]?.state).toBe('missing_contract_size');
  expect(f.feed.issue(symbol)).toContain('合约面值');
  expect(f.feed.diagnostics().symbols[0]?.receivedAt).not.toBeNull();
  f.feed.setContractSizes('GATE', [{ base: 'BTC', quote: 'USDT', multiplier: '.01' }]);
  expect(f.feed.diagnostics().symbols[0]?.state).toBe('ready');
  expect(f.feed.issue(symbol)).toBeNull();
});

it('完整快照合并保留真实接收时间，不把本机处理时间当作网络接收时间', async () => {
  const symbol = 'BINANCE_FUTURE_BTC_USDT'; const f = await fixture(symbol);
  f.send({}); await expect.poll(() => f.feed.book(symbol)).not.toBeNull();
  f.send({ a: [['102', '3']] });
  await expect.poll(() => f.feed.book(symbol)?.asks).toEqual([['102', '3']]);
  const d = f.feed.diagnostics().symbols[0]!;
  expect(d.state).toBe('ready');
  expect(d.appliedAt! - d.receivedAt!).toBeGreaterThan(100);
  expect(d.sourceAt).toBe(Date.parse(f.feed.book(symbol)!.updatedAt));
});


it('Hyperliquid HIP-3 原生订阅、确认、完整快照替换及重连', async () => {
  const symbol = 'HYPERLIQUID_FUTURE_NVDA_USDC'; const f = await fixture(symbol);
  expect(f.subscription).toEqual({ method: 'subscribe', subscription: { type: 'l2Book', coin: 'xyz:NVDA', fast: true } });
  expect(nativeSubscriptions('hyperliquid_book', 'unsubscribe', [symbol], () => 'xyz:NVDA')).toEqual([{ method: 'unsubscribe', subscription: { type: 'l2Book', coin: 'xyz:NVDA', fast: true } }]);
  f.socket.send(JSON.stringify({ channel: 'subscriptionResponse', data: f.subscription }));
  await expect.poll(() => f.feed.diagnostics().symbols[0]?.acknowledgedAt).not.toBeNull();
  f.send({}); await expect.poll(() => f.feed.book(symbol)?.asks).toEqual([['101', '5']]);
  expect(f.feed.book(symbol)?.source).toBe('venue_public_websocket');
  f.send({ a: [['102', '2']] });
  await expect.poll(() => f.feed.book(symbol)?.asks).toEqual([['102', '2']]);
  f.send({ ts: Date.now() - 10000, a: [['99', '99']] });
  await new Promise(resolve => setTimeout(resolve, 550));
  expect(f.feed.book(symbol)?.asks).toEqual([['102', '2']]);
  const next = new Promise<{ subscription: unknown; socket: WebSocket }>(resolve => {
    // fixture exposes the local server for reconnect verification.
    f.server.once('connection', socket => socket.on('message', raw => resolve({ subscription: JSON.parse(String(raw)), socket })));
  });
  f.socket.close();
  await expect.poll(() => f.feed.book(symbol)).toBeNull();
  const reconnected = await next;
  expect(reconnected.subscription).toEqual(f.subscription);
  reconnected.socket.send(JSON.stringify({ channel: 'l2Book', data: { coin: 'xyz:NVDA', time: Date.now(), levels: [[{ px: '103', sz: '7' }], [{ px: '104', sz: '6' }]] } }));
  await expect.poll(() => f.feed.book(symbol)?.asks).toEqual([['104', '6']]);
  f.feed.setSymbols([]);
  expect(f.feed.book(symbol)).toBeNull();
});

it('Hyperliquid 映射未知时不猜测订阅，移除映射即丢弃旧盘口', async () => {
  const symbol = 'HYPERLIQUID_FUTURE_BTC_USDC'; const f = await fixture(symbol);
  f.send({}); await expect.poll(() => f.feed.book(symbol)).not.toBeNull();
  f.feed.setHyperliquidMarkets({});
  expect(f.feed.book(symbol)).toBeNull();
  expect(f.feed.connections).toBe(0);
  expect(f.feed.issue(symbol)).toContain('映射未就绪');
  expect(f.feed.diagnostics().symbols[0]?.state).toBe('missing_market_mapping');
});


it('OKX 静默盘口使用真实 REST 快照恢复，保留合约单位及源时间', async () => {
  const symbol = 'OKX_FUTURE_BTC_USDT';
  const ts = Date.now();
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: '0', data: [{ ts: String(ts), asks: [['102', '7', '0', '1']], bids: [['101', '6', '0', '1']] }] })));
  const f = await fixture(symbol, [symbol], request);
  f.feed.setContractSizes('OKX', [{ base: 'BTC', quote: 'USDT', multiplier: '0.01' }]);
  f.send({ ts: ts - 10000 });
  await expect.poll(() => f.feed.book(symbol)?.updatedAt).toBe(new Date(ts).toISOString());
  expect(f.feed.book(symbol)?.asks).toEqual([['102', '0.07']]);
  expect(f.feed.book(symbol)?.source).toBe('venue_public_rest');
  expect(String(request.mock.calls[0][0])).toContain('instId=BTC-USDT-SWAP&sz=5');
});

it('OKX 迟到的 REST 不覆盖更新的 WS 盘口', async () => {
  const symbol = 'OKX_FUTURE_BTC_USDT';
  let finish!: (response: Response) => void;
  const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const f = await fixture(symbol, [symbol], request);
  f.send({ ts: Date.now() - 10000 });
  await expect.poll(() => request.mock.calls.length).toBe(1);
  const newer = Date.now();
  f.send({ ts: newer, a: [['103', '4']] });
  await expect.poll(() => f.feed.book(symbol)?.asks).toEqual([['103', '4']]);
  finish(new Response(JSON.stringify({ code: '0', data: [{ ts: String(newer - 1), asks: [['102', '7']], bids: [['101', '6']] }] })));
  await expect.poll(() => f.feed.diagnostics().symbols[0]?.restRefresh?.receivedAt).not.toBeNull();
  expect(f.feed.book(symbol)?.asks).toEqual([['103', '4']]);
  expect(f.feed.book(symbol)?.source).toBe('venue_public_websocket');
});

it.each(['429', 'stale'])('OKX REST 失败或过期时不刷新旧盘口且退避：%s', async reason => {
  const symbol = 'OKX_FUTURE_BTC_USDT'; const old = Date.now() - 10000;
  const request = vi.fn<typeof fetch>().mockImplementation(async () => reason === '429' ? new Response('', { status: 429 }) : new Response(JSON.stringify({ code: '0', data: [{ ts: String(old + 1), asks: [['102', '7']], bids: [['101', '6']] }] })));
  const f = await fixture(symbol, [symbol], request);
  f.send({ ts: old });
  await expect.poll(() => f.feed.diagnostics().symbols[0]?.restRefresh?.error).toBeTruthy();
  expect(f.feed.book(symbol)?.updatedAt).toBe(new Date(old).toISOString());
  await new Promise(resolve => setTimeout(resolve, 350));
  expect(request).toHaveBeenCalledTimes(1);
  expect(f.feed.connections).toBe(1);
});

it('OKX REST 取消订阅后中止在途请求，迟到响应不能复活盘口', async () => {
  const symbol = 'OKX_FUTURE_BTC_USDT';
  let finish!: (response: Response) => void;
  const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const f = await fixture(symbol, [symbol], request);
  f.send({ ts: Date.now() - 10000 });
  await expect.poll(() => request.mock.calls.length).toBe(1);
  f.feed.setSymbols([]);
  expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  finish(new Response(JSON.stringify({ code: '0', data: [{ ts: String(Date.now()), asks: [['102', '7']], bids: [['101', '6']] }] })));
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(f.feed.book(symbol)).toBeNull();
});

it('OKX 静默复核共享并发预算，停止时中止所有在途请求', async () => {
  const symbols = Array.from({ length: 12 }, (_, i) => `OKX_FUTURE_TEST${i}_USDT`);
  const request = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })));
  const f = await fixture(symbols[0], symbols, request);
  for (const symbol of symbols) f.socket.send(JSON.stringify({ arg: { channel: 'books5', instId: nativePair(symbol) }, data: [{ ts: String(Date.now() - 10000), asks: [['101', '5']], bids: [['100', '5']] }] }));
  await expect.poll(() => request.mock.calls.length, { timeout: 1500 }).toBe(8);
  await new Promise(resolve => setTimeout(resolve, 250));
  expect(request).toHaveBeenCalledTimes(8);
  f.feed.stop();
  expect(request.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
});

it('OKX 复核优先最旧盘口，避免刚静默的合约挤占即将过期的盘口', async () => {
  const symbols = ['OKX_FUTURE_NEW_USDT', 'OKX_FUTURE_OLD_USDT'];
  const request = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })));
  const f = await fixture(symbols[0], symbols, request);
  for (const [i, symbol] of symbols.entries()) f.socket.send(JSON.stringify({ arg: { channel: 'books5', instId: nativePair(symbol) }, data: [{ ts: String(Date.now() - (i ? 10000 : 1600)), asks: [['101', '5']], bids: [['100', '5']] }] }));
  await expect.poll(() => request.mock.calls.length).toBeGreaterThan(0);
  expect(String(request.mock.calls[0][0])).toContain('instId=OLD-USDT-SWAP');
});
