import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OBSERVATION_SETTINGS, ObservationSnapshotSchema, type ObservationMarket } from '@gate-crossex/shared-types';
import { AssetMonitor, normalizeGold, stableDirections } from './asset-monitor.js';
import { depthTo0998, cleanQuote, ObservationFeed, relevant, type FeedResult } from './observation-feed.js';

const time=1800000000000;
function market(overrides:Partial<ObservationMarket>={}):ObservationMarket{return {id:'GATE:spot:USDC_USDT',venue:'GATE',nativeSymbol:'USDC_USDT',base:'USDC',quote:'USDT',product:'spot',category:'stable',bid:'0.98',ask:'0.9899',bidSize:'100',askSize:'200',observedAt:time,sourceAt:null,error:null,...overrides};}
const dbs:Database.Database[]=[];
afterEach(()=>{for(const db of dbs.splice(0))db.close();});
function fixture(){const db=new Database(':memory:');db.exec(readFileSync(new URL('../../../migrations/0020_asset_monitor.sql',import.meta.url),'utf8'));dbs.push(db);let now=time,rows=[market()];const send=vi.fn(async()=>'sent' as const);const source={collect:vi.fn(async():Promise<FeedResult[]>=>[{venue:'GATE',product:'spot',markets:rows.map(r=>({...r,observedAt:now})),checkedAt:now,error:null}]),stop:vi.fn()};const service=new AssetMonitor(db,source,{marketStats:null,now:()=>now,send,configured:()=>true});return{db,source,service,send,set:(r:ObservationMarket[])=>{rows=r;},step:async(ms=10000)=>{now+=ms;await service.refresh();},now:()=>now};}

describe('稳定币方向与黄金估值',()=>{
 it('严格小于阈值，反向价格取买一倒数且换算容量单位',()=>{
  const rows=stableDirections([market({bid:'2',ask:'2.1'})],time,'.99');expect(rows[1]).toMatchObject({buy:'USDT',pay:'USDC',price:'0.5',payAmount:'100',status:'discount'});expect(rows[0].payAmount).toBe('420');
  expect(stableDirections([market({ask:'0.99'})],time,'.99')[0].status).toBe('normal');
  expect(stableDirections([market()],time,'.99')[0].status).toBe('discount');
  expect(stableDirections([market()],time+30001,'.99')[0]).toMatchObject({price:null,status:'stale'});
 });
 it('黄金只接受 USDT 永续，排除 USD、USDC 和收益凭证',()=>{expect(relevant('SUSDE','USDT','spot')).toBeNull();expect(relevant('FAKEUSD','USDT','spot')).toBeNull();expect(relevant('USDC','USDT','perpetual')).toBeNull();expect(relevant('XAUT','USDT','spot')).toBeNull();expect(relevant('XAUT','USDT','perpetual')).toBe('gold');expect(relevant('XAUT','USD','perpetual')).toBeNull();expect(relevant('PAXG','USDC','perpetual')).toBeNull();expect(stableDirections([market({base:'USD'})],time,'.99')).toHaveLength(0);});
 it('空盘口、倒挂、旧时间拒绝参与判断',()=>{const m=market();expect(cleanQuote(m,'0','1','1','1',time).error).not.toBeNull();expect(cleanQuote(m,'2','1','1','1',time).error).not.toBeNull();expect(cleanQuote(m,'1','1','1','1',time,time-40000).error).not.toBeNull();});
 it('黄金实时报价只保留 USDT 原始盘口，不使用稳定币汇率',()=>{
  const gold=market({id:'GATE:perpetual:PAXG_USDT',base:'PAXG',quote:'USDT',category:'gold',product:'perpetual',bid:'4000',ask:'4002'}),bridge=market({bid:'.98',ask:'.98'});
  expect(normalizeGold([gold,bridge],time)[0]).toMatchObject({ready:true,bid:'4000',ask:'4002',normalizedAt:time});
  expect(normalizeGold([gold,{...bridge,observedAt:time-15000}],time)[0].ready).toBe(true);
  expect(normalizeGold([{...gold,quote:'USD'},{...gold,quote:'USDC'}],time)).toEqual([]);
 });
});
describe('后台采集、事件与持久化',()=>{
 it('持续阈值、通知一次、重启去重、恢复后重新累计',async()=>{const f=fixture();f.service.save({...DEFAULT_OBSERVATION_SETTINGS,notificationsEnabled:true});await f.service.refresh();await f.step();await f.step();expect(f.send).not.toHaveBeenCalled();await f.step();await f.step();expect(f.send).toHaveBeenCalledTimes(1);await f.service.stop();
  const restart=new AssetMonitor(f.db,f.source,{marketStats:null,now:f.now,send:f.send,configured:()=>true});await restart.refresh();expect(restart.snapshot().events).toHaveLength(1);await restart.stop();
  f.set([market({bid:'.999',ask:'1'})]);await f.step();await f.step();await f.step();await f.step();f.set([market()]);await f.step();await f.step();await f.step();await f.step();expect(f.send).toHaveBeenCalledTimes(2);expect(ObservationSnapshotSchema.safeParse(f.service.snapshot()).success).toBe(true);
 });
 it('过期中断计时，恢复阈值附近抖动不重复通知',async()=>{const f=fixture();await f.service.refresh();await f.step(20000);f.set([market({error:'连接失败'})]);await f.step();f.set([market()]);await f.step();await f.step(20000);expect(f.service.snapshot().events).toHaveLength(0);await f.step();expect(f.service.snapshot().events).toHaveLength(1);f.set([market({ask:'.9905'})]);await f.step(30000);f.set([market()]);await f.step();await f.step(30000);expect(f.service.snapshot().events).toHaveLength(1);});
 it('单币支付范围不会给反方向计时',async()=>{const f=fixture();f.service.save({...DEFAULT_OBSERVATION_SETTINGS,paymentCoins:'USDC'});await f.service.refresh();await f.step(30000);expect(f.service.snapshot().events).toHaveLength(0);});
 it('其他支付币与小额第一档只观察，达到可用支付币和金额门槛后才计时',async()=>{
  const f=fixture();f.set([market({id:'CRVUSD_USDT',base:'CRVUSD',bid:'1.019',ask:'1.02',bidSize:'0.9',askSize:'200'})]);
  await f.service.refresh();await f.step(30000);
  expect(f.service.snapshot().stable.find(r=>r.pay==='CRVUSD')).toMatchObject({status:'discount',durationSeconds:0});
  expect(f.service.snapshot().events).toHaveLength(0);
  f.set([market({id:'USDE_USDT',base:'USDE',bid:'0.98',ask:'0.985',askSize:'0.9'})]);
  await f.step();await f.step(30000);expect(f.service.snapshot().events).toHaveLength(0);
  f.set([market({id:'USDE_USDT',base:'USDE',bid:'0.98',ask:'0.985',askSize:'200'})]);
  await f.step();await f.step(30000);
  expect(f.service.snapshot().events).toHaveLength(1);
  expect(f.service.snapshot().events[0].message).toContain('提醒门槛100 USDT');
 });
 it('旧版全部支付币设置迁移为 USDT 与 USDC，并补默认金额门槛',()=>{
  const f=fixture();f.db.prepare('INSERT INTO observation_settings VALUES (1,?)').run(JSON.stringify({threshold:'0.98',durationSeconds:45,notificationsEnabled:false,paymentCoins:'all',bidirectional:true}));
  const restored=new AssetMonitor(f.db,f.source,{marketStats:null,now:f.now});
  expect(restored.settings).toMatchObject({threshold:'0.98',durationSeconds:45,paymentCoins:'both',minPayAmount:100});
 });
 it('价格恢复时即使盘口变薄也可重新布防',async()=>{
  const f=fixture();await f.service.refresh();await f.step(30000);expect(f.service.snapshot().events).toHaveLength(1);
  f.set([market({ask:'1',askSize:'0.9'})]);await f.step();await f.step(30000);
  f.set([market()]);await f.step();await f.step(30000);
  expect(f.service.snapshot().events).toHaveLength(2);
 });
 it('同轮历史按真实汇率保存，失败不补造；30天自动清理',async()=>{const f=fixture();const a=market({id:'gold-a',base:'PAXG',category:'gold',product:'perpetual',bid:'4000',ask:'4000'}),b=market({id:'gold-b',base:'XAUT',category:'gold',product:'perpetual',bid:'4040',ask:'4040'});f.set([a,b]);await f.service.refresh();const h=f.service.history(a.id,b.id,24);expect(h.sampleCount).toBe(1);expect(h.points[0].value).toBeCloseTo(-.990099);f.set([{...a,error:'无盘口'},b]);await f.step(60000);expect(f.service.history(a.id,b.id,24).sampleCount).toBe(1);f.set([]);await f.step(31*86400000);expect(f.service.history(a.id,b.id,720).points).toHaveLength(0);});
 it('single flight与停止等待采集完成',async()=>{const f=fixture();const first=f.service.refresh(),second=f.service.refresh();expect(first).toBe(second);await f.service.stop();expect(f.source.collect).toHaveBeenCalledTimes(1);expect(f.source.stop).toHaveBeenCalledOnce();});
});

describe('官方现货目录适配',()=>{
 const cases=[
  {venue:'GATE',catalog:[{id:'USDC_USDT',base:'USDC',quote:'USDT',trade_status:'tradable'}],book:{bids:[['.999','10']],asks:[['1','20']]}},
  {venue:'BINANCE',catalog:{symbols:[{symbol:'USDCUSDT',baseAsset:'USDC',quoteAsset:'USDT',status:'TRADING'}]},book:{bids:[['.999','10']],asks:[['1','20']]}},
  {venue:'OKX',catalog:{code:'0',data:[{instId:'USDC-USDT',baseCcy:'USDC',quoteCcy:'USDT',state:'live'}]},book:{code:'0',data:[{bids:[['.999','10','0','1']],asks:[['1','20','0','1']]}]}},
  {venue:'BYBIT',catalog:{retCode:0,result:{list:[{symbol:'USDCUSDT',baseCoin:'USDC',quoteCoin:'USDT',status:'Trading'}]}},book:{retCode:0,time,result:{b:[['.999','10']],a:[['1','20']]}}},
  {venue:'KRAKEN',catalog:{error:[],result:{USDCUSDT:{wsname:'USDC/USDT',status:'online'}}},book:{error:[],result:{USDCUSDT:{bids:[['.999','10',time/1000]],asks:[['1','20',time/1000]]}}}},
  {venue:'HYPERLIQUID',catalog:{tokens:[{index:0,name:'USDC',isCanonical:true},{index:1,name:'USDe',isCanonical:true}],universe:[{name:'@1',tokens:[1,0]}]},book:{time,levels:[[{px:'.999',sz:'10'}],[{px:'1',sz:'20'}]]}},
 ] as const;
 it.each(cases)('$venue discovers and validates a real-shaped snapshot',async({venue,catalog,book})=>{let calls=0;const fetcher=vi.fn(async()=>new Response(JSON.stringify(calls++===0?catalog:book),{headers:{'Content-Type':'application/json'}})) as unknown as typeof fetch;const feed=new ObservationFeed(fetcher,()=>time);const r=await feed.load(venue,'spot');expect(r.error).toBeNull();expect(r.markets).toHaveLength(1);expect(r.markets[0]).toMatchObject({bid:'0.999',ask:'1',bidSize:'10',askSize:'20',error:null,forwardDepth:{payAmount:'0',buyAmount:'0',levels:0,complete:true},reverseDepth:{payAmount:'0',buyAmount:'0',levels:0,complete:true}});feed.stop();});
 it('拒绝HTTP失败，不把失败当作零市场正常',async()=>{const feed=new ObservationFeed(async()=>new Response('',{status:429}),()=>time);const r=await feed.load('GATE','spot');expect(r.error).toBe('HTTP 429');expect(r.markets).toHaveLength(0);feed.stop();});
 it('Hyperliquid 同名非canonical资产不接入',async()=>{const feed=new ObservationFeed(async()=>new Response(JSON.stringify({tokens:[{index:0,name:'USDC',isCanonical:true},{index:1,name:'USDe',isCanonical:false}],universe:[{name:'@1',tokens:[1,0]}]})),()=>time);expect((await feed.load('HYPERLIQUID','spot')).markets).toHaveLength(0);feed.stop();});
});

it('Kraken USD 黄金永续不进入监控目录，也不请求盘口',async()=>{
 const catalog={result:'success',instruments:[{symbol:'PF_XAUTUSD',pair:'XAUT:USD',tradeable:true}]};
 const book={result:'success',orderBook:{bids:[[266,1.88],[4319,3],[4318,2]],asks:[[4321.3,1],[4320.6,2]]}};
 let calls=0;const feed=new ObservationFeed(async()=>Response.json(calls++===0?catalog:book),()=>time);
 const result=await feed.load('KRAKEN','perpetual');
 expect(result.markets).toHaveLength(0);
 expect(calls).toBe(1);
 feed.stop();
});

it('Hyperliquid 按明确 tokenId 接入非 canonical USDe，拒绝同名不同ID',async()=>{
 const meta={tokens:[{index:0,name:'USDC',isCanonical:true},{index:1,name:'USDe',isCanonical:false,tokenId:'0x2e6d84f2d7ca82e6581e03523e4389f7'},{index:2,name:'USDe',isCanonical:false,tokenId:'0xwrong'}],universe:[{name:'@1',tokens:[1,0]},{name:'@2',tokens:[2,0]}]};
 let count=0;const feed=new ObservationFeed(async()=>new Response(JSON.stringify(count++===0?meta:{time,levels:[[{px:'.998',sz:'10'}],[{px:'.999',sz:'10'}]]})),()=>time);
 const result=await feed.load('HYPERLIQUID','spot');expect(result.markets).toHaveLength(1);expect(result.markets[0].nativeSymbol).toBe('@1');feed.stop();
});
it('源级失败退避时不重复请求',async()=>{const fetcher=vi.fn(async()=>new Response('',{status:429}));const feed=new ObservationFeed(fetcher,()=>time);await feed.load('GATE','spot');const second=await feed.load('GATE','spot');expect(fetcher).toHaveBeenCalledTimes(1);expect(second.error).toContain('退避');feed.stop();});

it('Hyperliquid 只保留 USDT 报价黄金，不按保证金币纳入 USD 市场',async()=>{
 const fetcher=async(_url:unknown,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));return new Response(JSON.stringify(body.type==='meta'?{universe:[{name:body.dex?'xyz:GOLD':'PAXG'}]}:{time,levels:[[{px:'4000',sz:'2'}],[{px:'4001',sz:'3'}]]}));};
 const feed=new ObservationFeed(fetcher as typeof fetch,()=>time);const r=await feed.load('HYPERLIQUID','perpetual');expect(r.markets.find(m=>m.base==='PAXG')?.quote).toBe('USDT');expect(r.markets.find(m=>m.nativeSymbol==='xyz:GOLD')).toBeUndefined();feed.stop();
});

it('Binance现货目录省略权限明细，避免大目录触发响应上限',async()=>{
 const symbols=[{symbol:'USDCUSDT',baseAsset:'USDC',quoteAsset:'USDT',status:'TRADING'},{symbol:'PAXGUSDT',baseAsset:'PAXG',quoteAsset:'USDT',status:'TRADING'}];
 const requests:URL[]=[];
 const feed=new ObservationFeed(async(input)=>{
  const url=new URL(String(input));requests.push(url);
  if(url.pathname.endsWith('/exchangeInfo'))return new Response(JSON.stringify({symbols:symbols.map(row=>({...row,permissionSets:url.searchParams.get('showPermissionSets')==='false'?[]:[['x'.repeat(6_100_000)]]}))}));
  return new Response(JSON.stringify({bids:[['1','10']],asks:[['1.001','20']]}));
 },()=>time);
 const result=await feed.load('BINANCE','spot');
 expect(result.error).toBeNull();expect(result.markets).toHaveLength(1);expect(result.markets.every(m=>m.category==='stable')).toBe(true);
 expect(requests[0].searchParams.get('permissions')).toBe('SPOT');
 expect(requests[0].searchParams.get('symbolStatus')).toBe('TRADING');
 expect(requests[0].searchParams.get('showPermissionSets')).toBe('false');
 feed.stop();
});
it('缩小Binance请求后仍保留超大响应保护',async()=>{
 const feed=new ObservationFeed(async()=>new Response('x'.repeat(12_000_001)),()=>time);
 expect((await feed.load('BINANCE','spot')).error).toBe('response_too_large');feed.stop();
});

it('历史均值取原始已结束分钟，独立于图表降采样且排除当前分钟',()=>{
 const f=fixture(),end=Math.floor(f.now()/60000)*60000;
 const insert=f.db.prepare('INSERT INTO observation_history VALUES (?,?,?,?,?)');
 [0,0,0,0,10,20].forEach((premium,i)=>{const t=end-(6-i)*60000;insert.run('a',t,t,t,String(100+premium));insert.run('b',t,t,t,'100');});
 insert.run('a',end,end,end,'200');insert.run('b',end,end,end,'100');
 const short=f.service.history('a','b',1,24),long=f.service.history('a','b',168,24);
 expect(short.reference).toEqual(long.reference);expect(short.reference.meanPct).toBe(5);expect(short.reference.sampleCount).toBe(6);expect(short.reference.expectedSamples).toBe(1440);expect(short.reference.sufficient).toBe(false);expect(short.reference.fresh).toBe(true);
 expect(short.points.at(-1)?.value).toBe(100);expect(long.points.length).toBeLessThan(short.points.length);
});
it('历史覆盖充分但最后有效样本太旧时不得作为实时基准',async()=>{
 const f=fixture(),end=Math.floor(f.now()/60000)*60000,insert=f.db.prepare('INSERT INTO observation_history VALUES (?,?,?,?,?)');
 f.db.transaction(()=>{for(let i=1;i<=1440;i++){const t=end-i*60000;insert.run('a',t,t,t,'99.5');insert.run('b',t,t,t,'100');}})();
 expect(f.service.history('a','b',1,24).reference).toMatchObject({meanPct:-.5,coverage:1,sufficient:true,fresh:true});
 await f.step(180000);expect(f.service.history('a','b',1,24).reference).toMatchObject({sufficient:false,fresh:false});
});

it('图表分钟周期改变采样密度，但不改变独立历史均值',()=>{
 const f=fixture(),end=Math.floor(f.now()/300000)*300000,insert=f.db.prepare('INSERT INTO observation_history VALUES (?,?,?,?,?)');
 for(let i=1;i<=6;i++){const t=end-i*60000;insert.run('a',t,t,t,String(100+i));insert.run('b',t,t,t,'100');}
 const minute=f.service.history('a','b',10,168,1),five=f.service.history('a','b',10,168,5),fifteen=f.service.history('a','b',10,168,15);
 expect(minute.points).toHaveLength(6);expect(five.points).toHaveLength(2);expect(fifteen.points).toHaveLength(1);
 expect(five.points.at(-1)?.value).toBe(1);expect(five.intervalMs).toBe(300000);expect(minute.reference).toEqual(five.reference);expect(five.reference).toEqual(fifteen.reference);
});
it('周周期按UTC周一分桶，保留每周最后一笔真实记录',()=>{
 const f=fixture(),week=7*86400000,offset=4*86400000,monday=Math.floor((f.now()-offset)/week)*week+offset;
 const insert=f.db.prepare('INSERT INTO observation_history VALUES (?,?,?,?,?)');
 [monday-60000,monday+60000,monday+120000].forEach((t,i)=>{insert.run('a',t,t,t,String(100+i));insert.run('b',t,t,t,'100');});
 const result=f.service.history('a','b',720,168,10080);expect(result.points.map(p=>p.time)).toEqual([monday-60000,monday+120000]);expect(result.points.map(p=>p.value)).toEqual([0,2]);expect(result.intervalMs).toBe(week);
});

 describe('买到0.998的盘口深度',()=>{
 it('累计卖盘含边界，超过限价不计入，与平均价口径不同',()=>{
  expect(depthTo0998([['.98','100'],['.998','200'],['.999','1000']],false,100)).toEqual({payAmount:'297.6',buyAmount:'300',levels:2,complete:true});
 });
 it('反向用买盘换算，支付基础币数量，取得报价币金额',()=>{
  expect(depthTo0998([['1.02','100'],['1.003','200'],['1.002','1000']],true,100)).toEqual({payAmount:'300',buyAmount:'302.6',levels:2,complete:true});
 });
 it('满档未到限价标为下限，空或异常盘口不冒充零深度',()=>{
  expect(depthTo0998([['.98','100'],['.99','200']],false,2)?.complete).toBe(false);
  expect(depthTo0998([['.98','100']],false,2)?.complete).toBe(true);
  expect(depthTo0998([],false,100)).toBeNull();expect(depthTo0998([['.98','bad']],false,100)).toBeNull();
  expect(depthTo0998([['1','100'],['.99','200']],false,100)).toBeNull();
 });
 it('只展示有效快照对应方向的深度，过期和错误不沿用',()=>{
  const m=market({forwardDepth:depthTo0998([['.98','100']],false,100),reverseDepth:depthTo0998([['1.02','200']],true,100)});
  expect(stableDirections([m],time,'.99').map(r=>r.depthTo0998?.payAmount)).toEqual(['98','200']);
  expect(stableDirections([m],time+30001,'.99').every(r=>r.depthTo0998===null)).toBe(true);
  expect(stableDirections([{...m,error:'offline'}],time,'.99').every(r=>r.depthTo0998===null)).toBe(true);
 });
 it('稳定币请求多档并在同一快照计算，黄金不扩大请求',async()=>{
  const urls:string[]=[];const feed=new ObservationFeed(async(input)=>{const url=String(input);urls.push(url);return new Response(JSON.stringify(url.includes('currency_pairs')?[{id:'USDC_USDT',base:'USDC',quote:'USDT',trade_status:'tradable'},{id:'PAXG_USDT',base:'PAXG',quote:'USDT',trade_status:'tradable'}]:{bids:[['.97','100']],asks:[['.98','100'],['.998','200'],['1','300']]}));},()=>time);
  const result=await feed.load('GATE','spot');expect(urls.some(u=>u.includes('currency_pair=USDC_USDT&limit=100'))).toBe(true);expect(urls.some(u=>u.includes('currency_pair=PAXG_USDT'))).toBe(false);
  expect(result.markets.find(m=>m.base==='USDC')?.forwardDepth?.payAmount).toBe('297.6');feed.stop();
 });
 });

it('市值与成交额按买入币绑定，反向切换币种，查询不阻塞盘口',async()=>{
 const f=fixture();let finish!:()=>void;const refresh=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const stats={refresh,get:()=>null,getStats:(asset:string)=>({marketCapUsd:asset==='USDC'?100:200,volume24hUsd:10,updatedAt:time}),error:null,stop:()=>finish()};
 const service=new AssetMonitor(f.db,f.source,{now:f.now,marketStats:stats});await service.refresh();
 expect(refresh).toHaveBeenCalledWith(['USDC','USDT']);expect(service.snapshot().stable.map(r=>r.marketStats?.marketCapUsd)).toEqual([100,200]);
 expect(ObservationSnapshotSchema.safeParse(service.snapshot()).success).toBe(true);await service.stop();
});

it('FRAX与SUSD不进入市场发现及双向监控',()=>{
 for(const asset of ['FRAX','SUSD']){
  expect(relevant(asset,'USDT','spot')).toBeNull();expect(relevant('USDC',asset,'spot')).toBeNull();
  expect(stableDirections([market({base:asset}),market({quote:asset})],time,'.99')).toEqual([]);
 }
});

it('稳定币10秒内复用原时间盘口，黄金每轮请求',async()=>{
 let now=time;const urls:string[]=[];
 const feed=new ObservationFeed(async(input)=>{const url=String(input);urls.push(url);return Response.json(url.includes('currency_pairs')?[{id:'USDC_USDT',base:'USDC',quote:'USDT',trade_status:'tradable'},{id:'PAXG_USDT',base:'PAXG',quote:'USDT',trade_status:'tradable'}]:{bids:[['.999','10']],asks:[['1','20']]});},()=>now);
 await feed.load('GATE','spot');now+=2000;const second=await feed.load('GATE','spot');
 expect(second.markets.find(m=>m.base==='USDC')?.observedAt).toBe(time);expect(second.markets.find(m=>m.base==='PAXG')).toBeUndefined();
 expect(urls.filter(u=>u.includes('currency_pair=USDC_USDT'))).toHaveLength(1);expect(urls.filter(u=>u.includes('currency_pair=PAXG_USDT'))).toHaveLength(0);
 now=time+10000;await feed.load('GATE','spot');expect(urls.filter(u=>u.includes('currency_pair=USDC_USDT'))).toHaveLength(2);feed.stop();
});

it('黄金报价仅保留跨所永续，过滤遗留黄金现货',()=>{
 const rows=[market({id:'a',venue:'BINANCE',base:'PAXG',category:'gold',product:'perpetual'}),market({id:'b',venue:'GATE',base:'PAXG',category:'gold',product:'perpetual'}),market({id:'spot',base:'PAXG',category:'gold',product:'spot'})];
 expect(normalizeGold(rows,time).map(g=>g.market.id)).toEqual(['a','b']);
});

it('黄金后台双向告警独立于稳定币开关，修改稳定币规则不清除黄金去重',async()=>{
 const f=fixture();
 f.source.collect.mockImplementation(async()=>[
  {venue:'BINANCE',product:'perpetual',markets:[market({id:'gold-a',venue:'BINANCE',base:'PAXG',category:'gold',product:'perpetual',bid:'99.6',ask:'99.6',observedAt:f.now()})],checkedAt:f.now(),error:null},
  {venue:'GATE',product:'perpetual',markets:[market({id:'gold-b',base:'XAUT',category:'gold',product:'perpetual',bid:'100',ask:'100',observedAt:f.now()})],checkedAt:f.now(),error:null},
 ]);
 expect(f.service.settings.notificationsEnabled).toBe(false);
 await f.service.refresh();await f.step();await f.step();await f.service.stop();
 expect(f.send).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[0]).toEqual(['黄金价差超过35 bps',expect.stringContaining('跨黄金标的')]);
 expect(f.service.snapshot().events[0]).toMatchObject({status:'sent',directionId:expect.stringMatching(/^gold:/)});
 f.service.save({...DEFAULT_OBSERVATION_SETTINGS,threshold:'0.98'});
 expect(f.db.prepare("SELECT COUNT(*) AS n FROM observation_episodes WHERE direction_id LIKE 'gold:%'").get()).toEqual({n:1});
 const restarted=new AssetMonitor(f.db,f.source,{marketStats:null,now:f.now,send:f.send,configured:()=>true});
 await restarted.refresh();await restarted.stop();expect(f.send).toHaveBeenCalledTimes(1);
});

it('黄金与稳定币设置分别保存，重启均可恢复',()=>{
 const f=fixture(),gold={thresholdBps:50,durationSeconds:15,recoveryBps:20,recoverySeconds:10,notificationsEnabled:false};
 f.service.saveGold(gold);f.service.save({...DEFAULT_OBSERVATION_SETTINGS,threshold:'0.98'});
 const restored=new AssetMonitor(f.db,f.source,{marketStats:null,now:f.now,send:f.send,configured:()=>true});
 expect(restored.snapshot().goldSettings).toEqual(gold);expect(restored.settings.threshold).toBe('0.98');
 restored.saveGold({...gold,thresholdBps:60});
 const again=new AssetMonitor(f.db,f.source,{marketStats:null,now:f.now,send:f.send,configured:()=>true});
 expect(again.settings.threshold).toBe('0.98');expect(again.snapshot().goldSettings?.thresholdBps).toBe(60);
});
