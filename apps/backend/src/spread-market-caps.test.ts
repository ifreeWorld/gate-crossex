import { describe, expect, it, vi } from 'vitest';
import { SpreadMarketCaps } from './spread-market-caps.js';

describe('流通市值数据源', () => {
  const start = Date.UTC(2026, 8, 20, 12);
  const coin = (id: string, symbol: string, market_cap: number | null, at = start) => ({ id, symbol, market_cap, fully_diluted_valuation: 999e9, last_updated: new Date(at).toISOString() });
  it('固定币 ID、唯一 symbol 和未知值，不使用 FDV 或同名最大市值', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json([
      coin('fake-bitcoin', 'btc', 999e12), coin('bitcoin', 'btc', 100e9),
      coin('alpha', 'aaa', 50e6), coin('foo-one', 'foo', 99e9), coin('foo-two', 'foo', 10),
      coin('bar', 'bar', null), coin('old', 'old', 1e9, start - 31 * 60000), coin('zero', 'zero', 0),
    ]));
    const source = new SpreadMarketCaps({ now: () => start, fetch: request });
    await source.refresh(['BTC', 'AAA', 'FOO', 'BAR', 'MISSING', 'OLD', 'ZERO']);
    expect(source.get('BTC')).toBe(100e9);
    expect(source.get('aaa')).toBe(50e6);
    for (const asset of ['FOO', 'BAR', 'MISSING', 'OLD']) expect(source.get(asset)).toBeNull();
    expect(source.get('ZERO')).toBe(0);
    const url = request.mock.calls[0][0] as URL;
    expect(url.searchParams.get('include_tokens')).toBe('all');
    expect(url.searchParams.get('vs_currency')).toBe('usd');
  });
  it('缓存、失败重试和过期拒绝，恢复后更新', async () => {
    let now = start;
    const request = vi.fn<typeof fetch>(async () => Response.json([coin('bitcoin', 'btc', 1e9, now)]));
    const source = new SpreadMarketCaps({ now: () => now, fetch: request });
    await source.refresh(['BTC']); await source.refresh(['BTC']);
    expect(request).toHaveBeenCalledTimes(1);
    now += 10 * 60000;
    request.mockResolvedValue(new Response('', { status: 429 }));
    await source.refresh(['BTC']); await source.refresh(['BTC']);
    expect(request).toHaveBeenCalledTimes(2);
    expect(source.error).toContain('加载失败');
    expect(source.get('BTC')).toBe(1e9);
    now += 21 * 60000;
    expect(source.get('BTC')).toBeNull();
    request.mockImplementation(async () => Response.json([coin('bitcoin', 'btc', 2e9, now)]));
    await source.refresh(['BTC']);
    expect(source.get('BTC')).toBe(2e9); expect(source.error).toBeNull();
  });
  it('读取全部分页后才判断唯一 symbol', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(Array.from({ length: 250 }, (_, i) => coin(`a-${i}`, i ? `x-${i}` : 'aaa', 1e9))))
      .mockResolvedValueOnce(Response.json([coin('another-aaa', 'aaa', 1)]));
    const source = new SpreadMarketCaps({ now: () => start, fetch: request });
    await source.refresh(['AAA']);
    expect(request).toHaveBeenCalledTimes(2);
    expect(source.get('AAA')).toBeNull();
  });
  it('请求失败或格式异常不发布部分数据；停止后不再请求', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ error: 'bad payload' }));
    const source = new SpreadMarketCaps({ now: () => start, fetch: request });
    await source.refresh(['BTC']);
    expect(source.get('BTC')).toBeNull(); expect(source.error).not.toBeNull();
    source.stop(); await source.refresh(['ETH']);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

it('市值和24小时成交额独立保留空值与零，过期后一起隐藏', async () => {
  let now=Date.UTC(2026,8,23,12);const at=now;
  const source=new SpreadMarketCaps({now:()=>now,fetch:async()=>Response.json([
    {id:'tether',symbol:'usdt',market_cap:1000,total_volume:200,last_updated:new Date(at).toISOString()},
    {id:'fake-tether',symbol:'usdt',market_cap:9999,total_volume:9999,last_updated:new Date(at).toISOString()},
    {id:'usd-coin',symbol:'usdc',market_cap:null,total_volume:0,last_updated:new Date(at).toISOString()},
  ])});
  await source.refresh(['USDT','USDC']);
  expect(source.getStats('USDT')).toEqual({marketCapUsd:1000,volume24hUsd:200,updatedAt:at});
  expect(source.getStats('USDC')).toEqual({marketCapUsd:null,volume24hUsd:0,updatedAt:at});
  now+=31*60000;expect(source.getStats('USDT')).toBeNull();source.stop();
});
