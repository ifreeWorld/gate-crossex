import { Decimal } from 'decimal.js';
import { OBSERVATION_VENUES, type ObservationMarket, type ObservationVenue, type Candle, type StableDepth } from '@gate-crossex/shared-types';

// 版本化身份名单；市场目录只负责发现上市情况，不靠 USD 子串识别资产。
export const STABLE_ASSETS = ['USDT','USDC','DAI','USDE','FDUSD','TUSD','USDP','PYUSD','USD1','RLUSD','USDG','USDD','LUSD','GUSD','USDS','USDB','USD0','USDF','USDQ','USDR','BUSD','USDX','USDK','USDJ','USDH','MIM','DOLA','GHO','CRVUSD','EUSD'] as const;
const stable = new Set<string>(STABLE_ASSETS);
export const isStableAsset = (asset: string) => stable.has(asset);
// spotMeta 的 isCanonical 不是资产真伪判断。按已核实的 HyperCore tokenId 匹配非 canonical 稳定币。
// 来源：Hyperliquid spotMeta、Ethena Hyperliquid 集成、docs.usdh.com/usdh/hypercore。
const HYPER_SPOT_IDS: Record<string,string> = {
  USDE: '0x2e6d84f2d7ca82e6581e03523e4389f7',
  USDH: '0x54e00a5988577cb0b0c9ab0cb6ef7f4b',
};
const recognizedHyperToken = (t: Record<string,unknown> | undefined) => !!t && (t.isCanonical === true || (Boolean(HYPER_SPOT_IDS[String(t.name).toUpperCase()]) && HYPER_SPOT_IDS[String(t.name).toUpperCase()] === t.tokenId));

export type FeedResult = { venue: ObservationVenue; product: 'spot' | 'perpetual'; markets: ObservationMarket[]; error: string | null; checkedAt: number };
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const txt = (v: unknown) => typeof v === 'string' || typeof v === 'number' ? String(v) : '';
const asset = (v: unknown) => txt(v).toUpperCase();
// Kraken 永续 REST 盘口可能把低价买单放在数组开头，不能按首项取买一。
function bestLevel(rows: unknown, highest: boolean): [string | null, string | null] {
  let best: [string, string] | null = null;
  for (const row of arr(rows)) {
    const [rawPrice, rawSize] = arr(row), price = positive(rawPrice), size = positive(rawSize);
    if (price && size && (!best || (highest ? new Decimal(price).gt(best[0]) : new Decimal(price).lt(best[0])))) best = [price, size];
  }
  return best ?? [null, null];
}
export function positive(v: unknown): string | null {
  try { const n = new Decimal(txt(v)); return n.isFinite() && n.gt(0) ? n.toFixed() : null; } catch { return null; }
}
export function relevant(base: string, quote: string, product: 'spot' | 'perpetual'): 'stable' | 'gold' | null {
  if (['PAXG','XAUT','XAU'].includes(base) && quote === 'USDT' && product === 'perpetual') return 'gold';
  if (product === 'spot' && ((stable.has(base) && stable.has(quote)) || (base === 'USDT' && quote === 'USD') || (base === 'USD' && quote === 'USDT'))) return 'stable';
  return null;
}
export function cleanQuote(m: ObservationMarket, bid: unknown, ask: unknown, bidSize: unknown, askSize: unknown, at: number, source: unknown = null): ObservationMarket {
  const b = positive(bid), a = positive(ask), stamp = Number(source);
  const sourceAt = source !== null && Number.isFinite(stamp) && stamp > 0 ? (stamp < 1e12 ? stamp * 1000 : stamp) : null;
  const error = !a || !b ? '盘口为空或价格无效' : new Decimal(b).gt(a) ? '买卖盘口倒挂' : sourceAt !== null && (at - sourceAt > 30000 || sourceAt - at > 5000) ? '上游行情时间异常或过期' : null;
  return { ...m, bid: b, ask: a, bidSize: positive(bidSize), askSize: positive(askSize), observedAt: at, sourceAt, error };
}
/** 支付币金额累计到限价（含0.998）；未越过阈值且档位用满时只能报告下限。 */
export function depthTo0998(raw: unknown, inverse: boolean, limit: number): StableDepth | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  let pay = new Decimal(0), buy = new Decimal(0), levels = 0, crossed = false;
  for (const row of raw) {
    const [p, q] = arr(row), price = positive(p), size = positive(q);
    if (!price || !size) return null;
    const eligible = inverse ? new Decimal(price).mul('0.998').gte(1) : new Decimal(price).lte('0.998');
    if (!eligible) { crossed = true; continue; }
    // 乱序盘口不能被误当作已完整覆盖。
    if (crossed) return null;
    pay = pay.plus(inverse ? size : new Decimal(price).mul(size));
    buy = buy.plus(inverse ? new Decimal(price).mul(size) : size);
    levels++;
  }
  return { payAmount: pay.toFixed(), buyAmount: buy.toFixed(), levels, complete: crossed || raw.length < limit };
}
type Instrument = ObservationMarket & { sizeFactor?: string };
export class ObservationFeed {
  private stableBooks = new Map<string,{at:number;market:ObservationMarket}>();
  private catalog = new Map<string, { at: number; markets: Instrument[] }>();
  private abort = new AbortController();
  private failures = new Map<string, {until:number;count:number;error:string;checkedAt:number}>();
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly now = Date.now) {}
  stop() { this.abort.abort(); }
  private async json(url: string, body?: unknown): Promise<unknown> {
    const r = await this.fetcher(url, { signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(8000)]), redirect: 'error', headers: { 'User-Agent': 'gate-crossex-monitor/1.0', 'Content-Type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    // 流式限长，防止异常上游响应撑爆内存。
    const reader = r.body?.getReader(); if (!reader) throw new Error('empty_response');
    const chunks: Uint8Array[] = []; let bytes = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 12_000_000) throw new Error('response_too_large'); chunks.push(value); } } finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }
  private market(venue: ObservationVenue, product: 'spot' | 'perpetual', symbol: string, base: string, quote: string, sizeFactor?: string): Instrument | null {
    const category = relevant(base, quote, product); if (!category) return null;
    return { id: `${venue}:${product}:${symbol}`, venue, product, nativeSymbol: symbol, base, quote, category, bid: null, ask: null, bidSize: null, askSize: null, observedAt: 0, sourceAt: null, error: '等待盘口', sizeFactor };
  }
  private async discover(venue: ObservationVenue, product: 'spot' | 'perpetual'): Promise<Instrument[]> {
    const key = `${venue}:${product}`, old = this.catalog.get(key);
    if (old && this.now() - old.at < 3600000) return old.markets;
    const spot = product === 'spot'; let markets: Instrument[] = [];
    const add = (symbol: unknown, base: unknown, quote: unknown, factor?: string) => { const m = this.market(venue, product, txt(symbol), asset(base), asset(quote), factor); if (m) markets.push(m); };
    if (venue === 'GATE') {
      const rows = await this.json(`https://api.gateio.ws/api/v4/${spot ? 'spot/currency_pairs' : 'futures/usdt/contracts'}`);
      if (!Array.isArray(rows)) throw new Error('invalid_catalog');
      for (const v of rows) { const r = obj(v); if (spot) { if (r.trade_status === 'tradable') add(r.id,r.base,r.quote); } else if (r.in_delisting !== true && txt(r.name).endsWith('_USDT')) add(r.name,txt(r.name).slice(0,-5),'USDT',positive(r.quanto_multiplier) ?? undefined); }
    } else if (venue === 'BINANCE') {
      // 默认 permissionSets 会使全目录超过 12 MB；这里只需要交易中的现货元数据。
      const data = obj(await this.json(spot ? 'https://api.binance.com/api/v3/exchangeInfo?permissions=SPOT&showPermissionSets=false&symbolStatus=TRADING' : 'https://fapi.binance.com/fapi/v1/exchangeInfo'));
      if (!Array.isArray(data.symbols)) throw new Error('invalid_catalog');
      for (const v of arr(data.symbols)) { const r = obj(v); if (r.status === 'TRADING' && (spot ? r.isSpotTradingAllowed !== false : r.contractType === 'PERPETUAL')) add(r.symbol,r.baseAsset,r.quoteAsset); }
    } else if (venue === 'OKX') {
      const data = obj(await this.json(`https://www.okx.com/api/v5/public/instruments?instType=${spot?'SPOT':'SWAP'}`));
      if (data.code !== '0' || !Array.isArray(data.data)) throw new Error('invalid_catalog');
      for (const v of arr(data.data)) { const r = obj(v), parts = txt(r.instId).split('-'); if (r.state === 'live' && (spot || r.ctType === 'linear')) add(r.instId,spot?r.baseCcy:parts[0],spot?r.quoteCcy:parts[1],spot?undefined:positive(r.ctVal) ?? undefined); }
    } else if (venue === 'BYBIT') {
      let cursor = ''; const seen = new Set<string>();
      do { const data = obj(await this.json(`https://api.bybit.com/v5/market/instruments-info?category=${spot?'spot':'linear'}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`)); if (data.retCode !== 0) throw new Error('invalid_catalog'); const result = obj(data.result); if (!Array.isArray(result.list)) throw new Error('invalid_catalog');
        for (const v of arr(result.list)) { const r = obj(v); if (r.status === 'Trading' && (spot || r.contractType === 'LinearPerpetual')) add(r.symbol,r.baseCoin,r.quoteCoin); }
        cursor = spot?'':txt(result.nextPageCursor); if (cursor && seen.has(cursor)) throw new Error('catalog_cursor_loop'); seen.add(cursor);
      } while (cursor);
    } else if (venue === 'KRAKEN') {
      if (spot) { const data = obj(await this.json('https://api.kraken.com/0/public/AssetPairs')); if (arr(data.error).length || !data.result) throw new Error('invalid_catalog'); for (const [symbol,v] of Object.entries(obj(data.result))) { const r = obj(v), pair = txt(r.wsname).split('/'); if (r.status === 'online') add(symbol,pair[0],pair[1]); } }
      else { const data = obj(await this.json('https://futures.kraken.com/derivatives/api/v3/instruments')); if (data.result !== 'success' || !Array.isArray(data.instruments)) throw new Error('invalid_catalog'); for (const v of arr(data.instruments)) { const r=obj(v); if (r.tradeable === true && txt(r.symbol).startsWith('PF_')) { const pair=txt(r.pair).split(':'); add(r.symbol,pair[0],pair[1]); } } }
    } else {
      if (spot) { const data = obj(await this.json('https://api.hyperliquid.xyz/info',{ type:'spotMeta' })); if (!Array.isArray(data.tokens)||!Array.isArray(data.universe)) throw new Error('invalid_catalog'); const tokens=arr(data.tokens).map(obj); for (const v of arr(data.universe)) { const r=obj(v), ids=arr(r.tokens), b=tokens.find(t=>t.index===ids[0]),q=tokens.find(t=>t.index===ids[1]); if (recognizedHyperToken(b)&&recognizedHyperToken(q)) add(r.name,b!.name,q!.name); } }
      else { for (const dex of ['', 'xyz']) { const data=obj(await this.json('https://api.hyperliquid.xyz/info',{type:'meta',...(dex?{dex}:{})})); if (!Array.isArray(data.universe)) throw new Error('invalid_catalog'); for (const v of arr(data.universe)) { const r=obj(v),name=txt(r.name); if (r.isDelisted!==true && ['PAXG','XAUT','xyz:GOLD'].includes(name)) add(name,name==='xyz:GOLD'?'XAU':name,name==='xyz:GOLD'?'USD':'USDT'); } } }
    }
    markets = [...new Map(markets.map(m=>[m.id,m])).values()];
    this.catalog.set(key,{at:this.now(),markets}); return markets;
  }
  private async book(m: Instrument): Promise<ObservationMarket> {
    const s=encodeURIComponent(m.nativeSymbol),spot=m.product==='spot',deep=spot&&m.category==='stable',depthLimit=m.venue==='HYPERLIQUID'?20:m.venue==='BYBIT'?50:100; let bid:unknown,ask:unknown,bs:unknown,as:unknown,stamp:unknown=null;
    let bids:unknown,asks:unknown;
    const levels=(b:unknown,a:unknown)=>{ bids=b;asks=a; const b0=arr(arr(b)[0]),a0=arr(arr(a)[0]); [bid,bs]=b0;[ask,as]=a0; };
    if(m.venue==='GATE') { const r=obj(await this.json(`https://api.gateio.ws/api/v4/${spot?'spot':'futures/usdt'}/order_book?${spot?'currency_pair':'contract'}=${s}&limit=${deep?depthLimit:1}`));
      if(spot)levels(r.bids,r.asks);else{const b=obj(arr(r.bids)[0]),a=obj(arr(r.asks)[0]);bid=b.p;bs=b.s;ask=a.p;as=a.s;} // 盘口时间表示最后变化，不用于判断静默市场的 REST 复核是否过期。
    } else if(m.venue==='BINANCE') { const r=obj(await this.json(`${spot?'https://api.binance.com/api/v3':'https://fapi.binance.com/fapi/v1'}/depth?symbol=${s}&limit=${deep?depthLimit:5}`));levels(r.bids,r.asks);
    } else if(m.venue==='OKX') {const r=obj(await this.json(`https://www.okx.com/api/v5/market/books?instId=${s}&sz=${deep?depthLimit:1}`));if(r.code!=='0')throw new Error('invalid_book');const b=obj(arr(r.data)[0]);levels(b.bids,b.asks);}
    else if(m.venue==='BYBIT'){const r=obj(await this.json(`https://api.bybit.com/v5/market/orderbook?category=${spot?'spot':'linear'}&symbol=${s}&limit=${deep?depthLimit:1}`));if(r.retCode!==0)throw new Error('invalid_book');const b=obj(r.result);levels(b.b,b.a);stamp=r.time;}
    else if(m.venue==='KRAKEN'){if(spot){const r=obj(await this.json(`https://api.kraken.com/0/public/Depth?pair=${s}&count=${deep?depthLimit:1}`));if(arr(r.error).length)throw new Error('invalid_book');const b=obj(Object.values(obj(r.result))[0]);levels(b.bids,b.asks);}else{const r=obj(await this.json(`https://futures.kraken.com/derivatives/api/v3/orderbook?symbol=${s}`));if(r.result!=='success')throw new Error('invalid_book');const b=obj(r.orderBook);[bid,bs]=bestLevel(b.bids,true);[ask,as]=bestLevel(b.asks,false);}}
    else {const r=obj(await this.json('https://api.hyperliquid.xyz/info',{type:'l2Book',coin:m.nativeSymbol}));const lv=arr(r.levels),b=obj(arr(lv[0])[0]),a=obj(arr(lv[1])[0]);bid=b.px;bs=b.sz;ask=a.px;as=a.sz;stamp=r.time;bids=arr(lv[0]).map(v=>[obj(v).px,obj(v).sz]);asks=arr(lv[1]).map(v=>[obj(v).px,obj(v).sz]);}
    if(m.product==='perpetual'&&['GATE','OKX'].includes(m.venue)){ const factor=positive(m.sizeFactor); bs=factor&&positive(bs)?new Decimal(txt(bs)).mul(factor).toFixed():null;as=factor&&positive(as)?new Decimal(txt(as)).mul(factor).toFixed():null; }
    return cleanQuote({...m,...(deep?{forwardDepth:depthTo0998(asks,false,depthLimit),reverseDepth:depthTo0998(bids,true,depthLimit)}:{})},bid,ask,bs,as,this.now(),stamp);
  }
  async load(venue: ObservationVenue, product: 'spot' | 'perpetual'): Promise<FeedResult> {
    const key=`${venue}:${product}`,failure=this.failures.get(key);
    if(failure&&this.now()<failure.until)return {venue,product,markets:[],checkedAt:failure.checkedAt,error:failure.error+'（退避重试）'};
    try { const instruments=await this.discover(venue,product),markets:ObservationMarket[]=[];let index=0;
      await Promise.all(Array.from({length:Math.min(3,instruments.length)},async()=>{while(index<instruments.length&&!this.abort.signal.aborted){const m=instruments[index++],cached=this.stableBooks.get(m.id);if(m.category==='stable'&&cached&&this.now()-cached.at<10000){markets.push(cached.market);continue;}let result:ObservationMarket;try{result=await this.book(m);}catch{result={...m,error:'盘口请求失败',observedAt:0};}if(m.category==='stable')this.stableBooks.set(m.id,{at:this.now(),market:result});markets.push(result);}}));
      this.failures.delete(key);
      return {venue,product,markets,checkedAt:this.now(),error:markets.some(m=>m.error)?'部分市场盘口不可用':null};
    } catch(error){const message=error instanceof Error?error.message:'行情不可用',count=(failure?.count??0)+1,checkedAt=this.now();this.failures.set(key,{count,checkedAt,error:message,until:checkedAt+Math.min(300000,10000*2**Math.min(count-1,5))});return {venue,product,markets:[],checkedAt,error:message};}
  }
  /** 原生现货／永续 K 线；保留原始市场名，不能把现货套进永续符号。 */
  async candles(m: ObservationMarket, minutes: number, limit: number, before = this.now()): Promise<Candle[]> {
    const interval=({1:'1m',5:'5m',15:'15m',60:'1h',240:'4h',1440:'1d'} as Record<number,string>)[minutes];
    if(!interval)throw new Error('unsupported_candle_interval');
    const count=Math.min(1000,Math.max(1,limit)),step=minutes*60000,s=encodeURIComponent(m.nativeSymbol),spot=m.product==='spot';
    let rows:unknown[]=[],format:'array'|'gate'|'kraken'|'hyper'='array';
    if(m.venue==='GATE'){
      const from=Math.max(1,Math.floor((before-count*step)/1000)),to=Math.floor((before-1)/1000);
      const result=await this.json(`https://api.gateio.ws/api/v4/${spot?'spot':'futures/usdt'}/candlesticks?${spot?'currency_pair':'contract'}=${s}&interval=${interval}&from=${from}&to=${to}`);
      if(!Array.isArray(result))throw new Error('invalid_candles');rows=result;format=spot?'array':'gate';
    }else if(m.venue==='BINANCE'){
      const result=await this.json(`${spot?'https://api.binance.com/api/v3':'https://fapi.binance.com/fapi/v1'}/klines?symbol=${s}&interval=${interval}&limit=${count}&endTime=${before-1}`);
      if(!Array.isArray(result))throw new Error('invalid_candles');rows=result;
    }else if(m.venue==='OKX'){
      const bar=({1:'1m',5:'5m',15:'15m',60:'1H',240:'4H',1440:'1Dutc'} as Record<number,string>)[minutes];
      const result=obj(await this.json(`https://www.okx.com/api/v5/market/history-candles?instId=${s}&bar=${bar}&limit=${Math.min(count,300)}&after=${before}`));
      if(result.code!=='0'||!Array.isArray(result.data))throw new Error('invalid_candles');rows=result.data;
    }else if(m.venue==='BYBIT'){
      const result=obj(await this.json(`https://api.bybit.com/v5/market/kline?category=${spot?'spot':'linear'}&symbol=${s}&interval=${minutes===1440?'D':minutes}&limit=${count}&end=${before-1}`));
      if(result.retCode!==0||!Array.isArray(obj(result.result).list))throw new Error('invalid_candles');rows=arr(obj(result.result).list);
    }else if(m.venue==='KRAKEN'){
      if(spot){const result=obj(await this.json(`https://api.kraken.com/0/public/OHLC?pair=${s}&interval=${minutes}&since=${Math.max(0,Math.floor((before-count*step)/1000))}`));if(arr(result.error).length)throw new Error('invalid_candles');const data=Object.entries(obj(result.result)).find(([k])=>k!=='last')?.[1];if(!Array.isArray(data))throw new Error('invalid_candles');rows=data;}
      else {const result=obj(await this.json(`https://futures.kraken.com/api/charts/v1/trade/${s}/${interval}?count=${count}&to=${Math.floor((before-1)/1000)}`));if(!Array.isArray(result.candles))throw new Error('invalid_candles');rows=result.candles;format='kraken';}
    }else{
      const result=await this.json('https://api.hyperliquid.xyz/info',{type:'candleSnapshot',req:{coin:m.nativeSymbol,interval,startTime:Math.max(1,before-count*step),endTime:before-1}});
      if(!Array.isArray(result))throw new Error('invalid_candles');rows=result;format='hyper';
    }
    const candles:Candle[]=[];
    for(const value of rows){const r=obj(value),a=arr(value);let start:unknown,open:unknown,high:unknown,low:unknown,close:unknown,volume:unknown;
      if(format==='gate'||format==='hyper'){start=format==='gate'?Number(r.t)*1000:r.t;open=r.o;high=r.h;low=r.l;close=r.c;volume=r.v;}
      else if(format==='kraken'){start=r.time;open=r.open;high=r.high;low=r.low;close=r.close;volume=r.volume;}
      else if(m.venue==='GATE'){start=Number(a[0])*1000;volume=a[6]??a[1];close=a[2];high=a[3];low=a[4];open=a[5];}
      else{start=m.venue==='KRAKEN'?Number(a[0])*1000:a[0];open=a[1];high=a[2];low=a[3];close=a[4];volume=m.venue==='KRAKEN'?a[6]:a[5];}
      const t=Number(start),o=positive(open),h=positive(high),l=positive(low),c=positive(close);
      if(!Number.isFinite(t)||t<=0||t%step!==0||t>=before||t+step>this.now()||!o||!h||!l||!c)continue;
      candles.push({startTime:t,open:o,high:h,low:l,close:c,volume:positive(volume)??'0',closed:true});
    }
    return [...new Map(candles.map(c=>[c.startTime,c])).values()].sort((a,b)=>a.startTime-b.startTime);
  }
  async collect():Promise<FeedResult[]>{return Promise.all(OBSERVATION_VENUES.flatMap(v=>(['spot','perpetual'] as const).map(p=>this.load(v,p))));}
}
