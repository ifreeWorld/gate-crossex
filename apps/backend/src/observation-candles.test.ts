import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObservationCandleHistory } from './observation-candles.js';
import { ObservationFeed } from './observation-feed.js';
import { ObservationHistorySchema, type Candle, type ObservationMarket, type ObservationVenue } from '@gate-crossex/shared-types';
const now=Date.UTC(2026,8,23,12),hour=3600000;
const market=(id:string,quote='USDT'):ObservationMarket=>({id,venue:'GATE',product:'spot',category:'gold',nativeSymbol:id,base:id,quote,bid:null,ask:null,bidSize:null,askSize:null,observedAt:0,sourceAt:null,error:null});
const candle=(t:number,c='100'):Candle=>({startTime:t,open:c,high:c,low:c,close:c,volume:'1',closed:true});
const dbs:Database.Database[]=[];afterEach(()=>{for(const db of dbs.splice(0))db.close();});
function fixture(){const db=new Database(':memory:');db.exec(readFileSync(new URL('../../../migrations/0010_candle_cache.sql',import.meta.url),'utf8'));dbs.push(db);const loader=vi.fn(async(m:ObservationMarket,minutes:number,limit:number,before=now)=>Array.from({length:limit},(_,i)=>candle(before-(i+1)*minutes*60000,m.base==='PAXG'?'99.5':'100')).reverse());const store=new ObservationCandleHistory(db,loader,()=>now);return {db,loader,store};}
describe('交易所黄金历史按需回填',()=>{
 it('首次打开直接有历史，缓存原始K线，不依赖本地采样启动时长',async()=>{const f=fixture(),a=market('PAXG'),b=market('XAUT');const result=await f.store.query(a,b,10,168,5);expect(result.points).toHaveLength(120);expect(result.reference).toMatchObject({sampleCount:168,expectedSamples:168,coverage:1,meanPct:-.5,fresh:true,sufficient:true});expect(result.source).toBe('exchange_candles');expect(result.referenceIntervalMs).toBe(hour);expect(ObservationHistorySchema.safeParse(result).success).toBe(true);expect(f.db.prepare('SELECT COUNT(*) AS n FROM candle_cache').get()).toEqual({n:576});});
 it('相同窗口合并在途请求，缓存避免重复，显式刷新重新请求',async()=>{const f=fixture(),a=market('PAXG'),b=market('XAUT');await Promise.all([f.store.query(a,b,10,168,5),f.store.query(a,b,10,168,5)]);expect(f.loader).toHaveBeenCalledTimes(4);await f.store.query(a,b,10,168,5);expect(f.loader).toHaveBeenCalledTimes(4);await f.store.query(a,b,10,168,5,true);expect(f.loader).toHaveBeenCalledTimes(8);});
 it('USDT 黄金历史只加载两腿原始 K 线，不加载汇率市场',async()=>{const f=fixture(),a=market('PAXG'),b=market('XAUT');const result=await f.store.query(a,b,1,24,5);expect(result.points[0]).toMatchObject({leftClose:99.5,rightClose:100,value:-.5});expect(result.quote).toBe('USDT');expect(result.warning).toBeNull();expect(f.loader).toHaveBeenCalledTimes(4);});
 it('上游失败保留缓存并标记错误，不能假装最新',async()=>{const f=fixture(),a=market('PAXG'),b=market('XAUT');await f.store.query(a,b,1,24,5);f.loader.mockRejectedValue(new Error('offline'));const result=await f.store.query(a,b,1,24,5,true);expect(result.points.length).toBeGreaterThan(0);expect(result.warning).toContain('历史查询失败');});
 it('拒绝 USD 和 USDC 黄金历史查询',async()=>{const f=fixture(),a=market('PAXG','USD'),b=market('XAUT');await expect(f.store.query(a,b,1,24,5)).rejects.toThrow('仅支持 USDT');await expect(f.store.query({...a,quote:'USDT'}, {...b,quote:'USDC'},1,24,5)).rejects.toThrow('仅支持 USDT');expect(f.loader).not.toHaveBeenCalled();});
});
describe('六家历史K线解析',()=>{
 const t=now-hour;
 const cases:Array<{venue:ObservationVenue;payload:unknown}>=[
  {venue:'GATE',payload:[[String(t/1000),'500','101','102','99','100','5','true']]},
  {venue:'BINANCE',payload:[[t,'100','102','99','101','5']]},
  {venue:'OKX',payload:{code:'0',data:[[String(t),'100','102','99','101','5','0','0','1']]}},
  {venue:'BYBIT',payload:{retCode:0,result:{list:[[String(t),'100','102','99','101','5']]}}},
  {venue:'KRAKEN',payload:{error:[],result:{PAXGUSD:[[t/1000,'100','102','99','101','100','5',2]],last:t/1000}}},
  {venue:'HYPERLIQUID',payload:[{t,o:'100',h:'102',l:'99',c:'101',v:'5'}]},
 ];
 it.each(cases)('$venue 对齐已收盘K线',async({venue,payload})=>{const feed=new ObservationFeed(async()=>new Response(JSON.stringify(payload)),()=>now);const r=await feed.candles({...market('PAXG'),venue},60,10,now);expect(r).toEqual([candle(t,'101')].map(c=>({...c,open:'100',high:'102',low:'99',volume:'5'})));feed.stop();});
 it('当前未收盘和时间未对齐的K线不参与基准',async()=>{const feed=new ObservationFeed(async()=>new Response(JSON.stringify([[now,'100','102','99','101','5'],[now-hour+1,'100','102','99','101','5']])),()=>now);expect(await feed.candles({...market('PAXG'),venue:'BINANCE'},60,10,now+1)).toEqual([]);feed.stop();});
});

it('向前分页保留当前缓存，游标递减且不重查均值，失败可重试',async()=>{
 const f=fixture(),a=market('PAXG'),b=market('XAUT');
 const first=await f.store.query(a,b,5,168,1);expect(first.points).toHaveLength(300);expect(first.hasMore).toBe(true);
 const cached=f.db.prepare('SELECT COUNT(*) AS n FROM candle_cache').get();f.loader.mockClear();
 const older=await f.store.query(a,b,5,168,1,false,first.nextBefore!);
 expect(older.points).toHaveLength(300);expect(older.points.at(-1)!.time).toBeLessThan(first.points[0].time);expect(older.nextBefore).toBeLessThan(first.nextBefore!);expect(f.loader).toHaveBeenCalledTimes(2);expect(f.loader.mock.calls.every(c=>c[1]===1)).toBe(true);expect(f.db.prepare('SELECT COUNT(*) AS n FROM candle_cache').get()).toEqual(cached);
 f.loader.mockRejectedValueOnce(new Error('offline'));await expect(f.store.query(a,b,5,168,1,false,older.nextBefore!)).rejects.toThrow('offline');
 f.loader.mockResolvedValue([]);const end=await f.store.query(a,b,5,168,1,false,older.nextBefore!);expect(end.hasMore).toBe(false);
});

it('30天均值和极值来自完整720根小时线，不随图表周期和局部极值变化',async()=>{
 const f=fixture(),a=market('PAXG'),b=market('XAUT');
 f.loader.mockImplementation(async(m,minutes,limit,before=now)=>Array.from({length:limit},(_,i)=>{
  const t=before-(i+1)*minutes*60000;
  return candle(t,m.id==='PAXG'?(minutes===60?(t===now-700*hour?'90':t===now-710*hour?'110':'100'):'99'):'100');
 }));
 const one=await f.store.query(a,b,5,720,1),five=await f.store.query(a,b,25,720,5);
 expect(one.reference).toEqual(five.reference);expect(one.reference).toMatchObject({sampleCount:720,expectedSamples:720,minPct:-10,maxPct:10,meanPct:0});expect(one.points.every(p=>p.value===-1)).toBe(true);
});
