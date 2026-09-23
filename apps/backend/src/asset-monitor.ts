import { GoldAlerts } from './gold-alerts.js';
import { SpreadMarketCaps, type SpreadMarketCapSource } from './spread-market-caps.js';
import { ObservationCandleHistory, type ObservationCandleLoader } from './observation-candles.js';
import { Decimal } from 'decimal.js';
import type Database from 'better-sqlite3';
import { DEFAULT_OBSERVATION_SETTINGS, ObservationSettingsSchema, observationDirectionEligible, observationPaymentAllowed, type ObservationMarket, type ObservationSettings, type ObservationSnapshot, type GoldQuote, type StableDirection, type ObservationHistory, type GoldAlertSettings } from '@gate-crossex/shared-types';
import { ObservationFeed, STABLE_ASSETS, isStableAsset, type FeedResult } from './observation-feed.js';
import { barkConfigured, sendSpreadBark } from './spread-bark.js';

export const OBSERVATION_STALE_MS = 30000;
export const OBSERVATION_POLL_MS = 2000;
const SYNC_MS = 10000;
export function quoteReady(m: ObservationMarket, now: number): boolean { return !m.error && m.bid !== null && m.ask !== null && now-m.observedAt<=OBSERVATION_STALE_MS && m.observedAt<=now+5000; }
export function stableDirections(markets: ObservationMarket[], now: number, threshold: string): StableDirection[] {
  return markets.filter(m=>m.category==='stable'&&isStableAsset(m.base)&&isStableAsset(m.quote)).flatMap(m=>([false,true] as const).map(inverse=>{
    const ready=quoteReady(m,now)&&(inverse?m.bidSize!==null:m.askSize!==null),price=ready?inverse?new Decimal(1).div(m.bid!).toFixed():m.ask:null;
    const amount=ready?inverse?m.bidSize:m.askSize?new Decimal(m.askSize).mul(m.ask!).toFixed():null:null;
    return {id:`${m.id}:${inverse?'reverse':'forward'}`,marketId:m.id,venue:m.venue,nativeSymbol:m.nativeSymbol,buy:inverse?m.quote:m.base,pay:inverse?m.base:m.quote,inverse,price,payAmount:amount,depthTo0998:ready?(inverse?m.reverseDepth:m.forwardDepth)??null:null,status:!ready?'stale':new Decimal(price!).lt(threshold)?'discount':'normal',durationSeconds:0,observedAt:m.observedAt};
  }));
}
export function normalizeGold(markets:ObservationMarket[],now:number):GoldQuote[]{
  return markets.filter(m=>m.category==='gold'&&m.product==='perpetual'&&m.quote==='USDT').map(m=>{
    const raw={market:m,bid:null,ask:null,normalizedAt:null,conversion:'行情过期',ready:false} satisfies GoldQuote;
    if(!quoteReady(m,now))return {...raw,conversion:m.error??'行情过期'};
    return {...raw,bid:m.bid,ask:m.ask,normalizedAt:m.observedAt,conversion:m.venue==='HYPERLIQUID'&&m.nativeSymbol==='PAXG'?'原始 USDT 报价 / 金衡盎司 · USDC 保证金及盈亏结算':'原始 USDT 报价 / 金衡盎司',ready:true};
  });
}
export interface ObservationSource { collect():Promise<FeedResult[]>; stop():void; candles?:ObservationCandleLoader }
type Episode={since:number;last:number;recovery:number|null;alerted:boolean};
export class AssetMonitor {
  private goldAlerts: GoldAlerts;
  private marketStats: SpreadMarketCapSource | null;
  private statsPending: Promise<void> | null = null;
  settings:ObservationSettings;
  private candleHistory:ObservationCandleHistory|null;
  private markets:ObservationMarket[]=[];
  private sources:ObservationSnapshot['sources']=[];
  private updatedAt:number|null=null;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private running=false;
  private pending:Promise<void>|null=null;
  private episodes=new Map<string,Episode>();
  private notifications=new Set<Promise<unknown>>();
  private cleanedAt=0;
  private now:()=>number;
  private send:(title:string,body:string)=>Promise<'sent'|'failed'|'unknown'>;
  private configured:()=>boolean;
  constructor(private db:Database.Database,private feed:ObservationSource=new ObservationFeed(),options:{marketStats?:SpreadMarketCapSource|null;now?:()=>number;send?:(title:string,body:string)=>Promise<'sent'|'failed'|'unknown'>;configured?:()=>boolean}={}){
    this.now=options.now??Date.now;this.send=options.send??((title,body)=>sendSpreadBark(title,body,'稳定币监控'));this.configured=options.configured??barkConfigured;
    this.goldAlerts=new GoldAlerts(db,options.send??((title,body)=>sendSpreadBark(title,body,'黄金监控')),this.configured);
    this.marketStats=options.marketStats===undefined?new SpreadMarketCaps({now:this.now}):options.marketStats;
    this.candleHistory=feed.candles?new ObservationCandleHistory(db,feed.candles.bind(feed),this.now):null;
    const stored=db.prepare('SELECT payload FROM observation_settings WHERE id=1').get() as {payload:string}|undefined;
    let parsed:unknown;try{parsed=stored?JSON.parse(stored.payload):null;}catch{parsed=null;}
    // 旧版 all 曾让没有持仓的支付币进入提醒；迁移为 USDT + USDC。
    if(parsed&&typeof parsed==='object'&&'paymentCoins' in parsed&&parsed.paymentCoins==='all')parsed={...parsed,paymentCoins:'both'};
    const result=ObservationSettingsSchema.safeParse(parsed);this.settings=result.success?result.data:{...DEFAULT_OBSERVATION_SETTINGS};
    for(const r of db.prepare("SELECT direction_id,alerted FROM observation_episodes WHERE direction_id NOT LIKE 'gold:%'").all() as {direction_id:string;alerted:number}[])this.episodes.set(r.direction_id,{since:0,last:0,recovery:null,alerted:!!r.alerted});
    db.prepare("UPDATE observation_events SET status='unknown' WHERE status='pending'").run();
  }
  start(){if(this.running)return;this.running=true;const run=async()=>{try{await this.refresh();}catch{/* 下轮重试；旧报价自然过期。 */}finally{if(this.running){this.timer=setTimeout(()=>void run(),OBSERVATION_POLL_MS);this.timer.unref?.();}}};void run();}
  async stop(){this.running=false;if(this.timer)clearTimeout(this.timer);this.feed.stop();this.marketStats?.stop();await this.statsPending;await this.candleHistory?.stop();await this.pending;await this.goldAlerts.stop();await Promise.allSettled([...this.notifications]);}
  refresh():Promise<void>{this.pending??=this.refreshOnce().finally(()=>{this.pending=null;});return this.pending;}
  private async refreshOnce(){
    const results=await this.feed.collect(),now=this.now();
    for(const r of results){const old=this.markets.filter(m=>m.venue===r.venue&&m.product===r.product);this.markets=this.markets.filter(m=>m.venue!==r.venue||m.product!==r.product);
      const next=r.markets.length?r.markets:r.error?old.map(m=>({...m,error:r.error})):[];
      this.markets.push(...next.map(m=>m.observedAt===0?{...m,...(old.find(o=>o.id===m.id)?{bid:old.find(o=>o.id===m.id)!.bid,ask:old.find(o=>o.id===m.id)!.ask}:{}),error:m.error??'等待行情'}:m));
    }
    this.sources=results.map(r=>({venue:r.venue,product:r.product,count:r.markets.length,checkedAt:r.checkedAt,error:r.error}));this.updatedAt=now;
    const gold=this.candleHistory?[]:normalizeGold(this.markets,now).filter(g=>g.ready&&g.bid&&g.ask);
    this.db.transaction(()=>{for(const g of gold)this.db.prepare('INSERT INTO observation_history VALUES (?,?,?,?,?) ON CONFLICT(market_id,minute) DO UPDATE SET cycle=excluded.cycle,observed_at=excluded.observed_at,mid=excluded.mid').run(g.market.id,Math.floor(now/60000)*60000,now,g.normalizedAt,new Decimal(g.bid!).plus(g.ask!).div(2).toFixed());})();
    if(this.marketStats&&!this.statsPending){
      this.statsPending=this.marketStats.refresh([...new Set(this.markets.filter(m=>m.category==='stable').flatMap(m=>[m.base,m.quote]))]).catch(()=>{}).finally(()=>{this.statsPending=null;});
    }
    this.checkEpisodes(now);
    this.goldAlerts.check(normalizeGold(this.markets,now),now);
    if(now-this.cleanedAt>3600000){this.db.prepare('DELETE FROM observation_history WHERE minute < ?').run(now-30*86400000);this.db.prepare('DELETE FROM observation_events WHERE created_at < ?').run(now-90*86400000);this.cleanedAt=now;}
  }
  private selected(r:StableDirection){return (this.settings.bidirectional||!r.inverse)&&observationPaymentAllowed(r.pay,this.settings);}
  private checkEpisodes(now:number){
    const rows=stableDirections(this.markets,now,this.settings.threshold).filter(r=>this.selected(r)),active=new Set(rows.map(r=>r.id));
    for(const [id,e] of this.episodes)if(!active.has(id)){e.since=0;e.last=0;e.recovery=null;}
    for(const r of rows){let e=this.episodes.get(r.id);
      if(r.status==='stale'){if(e){e.since=0;e.last=0;e.recovery=null;}continue;}
      if(r.status==='discount'){
        if(!observationDirectionEligible(r,this.settings)){if(e){e.since=0;e.last=0;e.recovery=null;}continue;}
        e??={since:now,last:now,recovery:null,alerted:false};if(!e.since||now-e.last>OBSERVATION_STALE_MS)e.since=now;e.last=now;e.recovery=null;this.episodes.set(r.id,e);
        if(!e.alerted&&now-e.since>=this.settings.durationSeconds*1000){e.alerted=true;
          const message=`${r.venue} ${r.nativeSymbol} ${r.inverse?'反向':'正向'}：买入1 ${r.buy}支付${r.price} ${r.pay}；第一档金额${r.payAmount??'未知'} ${r.pay}（提醒门槛${this.settings.minPayAmount} ${r.pay}）。持续${this.settings.durationSeconds}秒低于${this.settings.threshold}，未扣费用。`;
          const notify=this.settings.notificationsEnabled&&this.configured();
          const id=this.db.transaction(()=>{this.db.prepare('INSERT INTO observation_episodes VALUES (?,1) ON CONFLICT(direction_id) DO UPDATE SET alerted=1').run(r.id);return Number(this.db.prepare('INSERT INTO observation_events(direction_id,message,created_at,status) VALUES (?,?,?,?)').run(r.id,message,now,notify?'pending':'recorded').lastInsertRowid);})();
          if(notify){const p=this.send('稳定币相对折价',message).catch(()=>'unknown' as const).then(status=>this.db.prepare('UPDATE observation_events SET status=? WHERE id=?').run(status,id));this.notifications.add(p);void p.finally(()=>this.notifications.delete(p));}
        }
      }else if(e){
        if(new Decimal(r.price!).gte(new Decimal(this.settings.threshold).plus('.001'))){if(now-e.last>OBSERVATION_STALE_MS)e.recovery=null;e.recovery??=now;if(now-e.recovery>=30000){this.episodes.delete(r.id);this.db.prepare('DELETE FROM observation_episodes WHERE direction_id=?').run(r.id);}}else e.recovery=null;
        e.since=0;e.last=now;
      }
    }
  }
  save(input:ObservationSettings){const next=ObservationSettingsSchema.parse(input);if(next.notificationsEnabled&&!this.configured())throw new Error('bark_not_configured');
    // 修改信号范围或阈值需要重新累计，持久化去重也按新的规则重新开始。
    const rule=(s:ObservationSettings)=>JSON.stringify({...s,notificationsEnabled:false});
    if(rule(next)!==rule(this.settings)){this.episodes.clear();this.db.prepare("DELETE FROM observation_episodes WHERE direction_id NOT LIKE 'gold:%'").run();}
    this.settings=next;this.db.prepare('INSERT INTO observation_settings VALUES (1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(JSON.stringify({...next,goldSettings:this.goldAlerts.settings}));return this.snapshot();
  }
  saveGold(input:GoldAlertSettings){this.goldAlerts.save(input);return this.snapshot();}
  snapshot():ObservationSnapshot{const now=this.now();return {updatedAt:this.updatedAt,pollingMs:OBSERVATION_POLL_MS,staleMs:OBSERVATION_STALE_MS,settings:this.settings,goldSettings:this.goldAlerts.settings,barkConfigured:this.configured(),sources:this.sources,registry:[...new Set(STABLE_ASSETS)],
    marketStatsError:this.marketStats?.error??null,stable:stableDirections(this.markets,now,this.settings.threshold).map(r=>({...r,marketStats:this.marketStats?.getStats?.(r.buy)??null,durationSeconds:r.status==='discount'&&observationDirectionEligible(r,this.settings)&&this.episodes.get(r.id)?.since?Math.floor((now-this.episodes.get(r.id)!.since)/1000):0})),gold:normalizeGold(this.markets,now),
    events:(this.db.prepare('SELECT id,direction_id AS directionId,message,created_at AS createdAt,status FROM observation_events ORDER BY id DESC LIMIT 100').all() as ObservationSnapshot['events'])};}
  async queryHistory(a:string,b:string,hours:number,referenceHours:number,intervalMinutes:number,force=false,before?:number):Promise<ObservationHistory>{
    if(!this.candleHistory)return this.history(a,b,hours,referenceHours,intervalMinutes);
    const left=this.markets.find(m=>m.id===a&&m.category==='gold'&&m.product==='perpetual'&&m.quote==='USDT'),right=this.markets.find(m=>m.id===b&&m.category==='gold'&&m.product==='perpetual'&&m.quote==='USDT');
    if(!left||!right)throw new Error('市场目录尚未就绪');
    return this.candleHistory.query(left,right,hours,referenceHours,intervalMinutes,force,before);
  }
  history(a:string,b:string,hours:number,referenceHours=168,intervalMinutes?:number):ObservationHistory{
    const end=this.now(),from=end-hours*3600000,closedBefore=Math.floor(end/60000)*60000,referenceFrom=closedBefore-referenceHours*3600000;
    const raw=this.db.prepare(`SELECT a.minute AS time,a.mid AS leftClose,b.mid AS rightClose FROM observation_history a JOIN observation_history b ON a.minute=b.minute AND a.cycle=b.cycle WHERE a.market_id=? AND b.market_id=? AND a.minute>=? AND ABS(a.observed_at-b.observed_at)<=? ORDER BY a.minute`).all(a,b,Math.min(from,referenceFrom),SYNC_MS) as {time:number;leftClose:string;rightClose:string}[];
    const intervalMs=intervalMinutes!==undefined?intervalMinutes*60000:hours<=24?60000:hours<=168?300000:900000;
    // 周采样以 UTC 周一为边界，其余周期以 UTC 自然时间分桶。
    const bucketOffset=intervalMinutes===10080?4*86400000:0;
    // 稀疏历史每桶仅取最后一笔同步采样，不插值。
    const buckets=new Map<number,ObservationHistory['points'][number]>();
    for(const r of raw.filter(r=>r.time>=from))buckets.set(Math.floor((r.time-bucketOffset)/intervalMs),{time:r.time,value:new Decimal(r.leftClose).div(r.rightClose).minus(1).mul(100).toNumber(),leftClose:Number(r.leftClose),rightClose:Number(r.rightClose)});
    const started=this.db.prepare('SELECT MIN(minute) AS first FROM observation_history WHERE market_id IN (?,?)').get(a,b) as {first:number|null};
    const referenceRows=raw.filter(r=>r.time>=referenceFrom&&r.time<closedBefore);
    const expectedSamples=referenceHours*60,coverage=referenceRows.length/expectedSamples,latestAt=referenceRows.at(-1)?.time??null;
    const fresh=latestAt!==null&&closedBefore-latestAt<=120000;
    const referenceValues=referenceRows.map(r=>new Decimal(r.leftClose).div(r.rightClose).minus(1).mul(100).toNumber());
    const meanPct=referenceRows.length?referenceRows.reduce((sum,r)=>sum.plus(new Decimal(r.leftClose).div(r.rightClose).minus(1).mul(100)),new Decimal(0)).div(referenceRows.length).toNumber():null;
    return {source:'local_samples',loadedAt:end,quote:'USDT',referenceIntervalMs:60000,warning:null,points:[...buckets.values()],sampleCount:raw.filter(r=>r.time>=from).length,intervalMs,startedAt:started.first,
      reference:{hours:referenceHours,meanPct,minPct:referenceValues.length?Math.min(...referenceValues):null,maxPct:referenceValues.length?Math.max(...referenceValues):null,sampleCount:referenceRows.length,expectedSamples,coverage,latestAt,fresh,sufficient:coverage>=.9&&fresh}};
  }
}
