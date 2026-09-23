import type Database from 'better-sqlite3';
import { Decimal } from 'decimal.js';
import type { Candle, ObservationHistory, ObservationMarket } from '@gate-crossex/shared-types';

export type ObservationCandleLoader = (market:ObservationMarket,minutes:number,limit:number,before?:number)=>Promise<Candle[]>;
/** 复用 candle_cache 存储原始已收盘 K 线；不存计算后的溢折价。命名空间避免污染交易页 K 线。 */
export class ObservationCandleHistory {
  private pending=new Map<string,Promise<{candles:Candle[];error:string|null}>>();
  private fetched=new Map<string,{at:number;error:string|null}>();
  private stopped=false;
  constructor(private readonly db:Database.Database,private readonly load:ObservationCandleLoader,private readonly now=Date.now){}
  async stop(){this.stopped=true;await Promise.allSettled([...this.pending.values()]);}
  private async series(m:ObservationMarket,minutes:number,from:number,force:boolean){
    const symbol=`OBSERVATION:${m.id}`,interval=String(minutes),end=Math.floor(this.now()/(minutes*60000))*minutes*60000;
    const key=`${symbol}:${interval}:${from}`;
    const read=()=> (this.db.prepare('SELECT start_time AS startTime,open,high,low,close,volume FROM candle_cache WHERE symbol=? AND interval=? AND start_time>=? AND start_time<? ORDER BY start_time').all(symbol,interval,from,end) as Omit<Candle,'closed'>[]).map(c=>({...c,closed:true}));
    const existing=this.pending.get(key);if(existing)return existing;
    const previous=this.fetched.get(key);if(!force&&previous&&this.now()-previous.at<30000)return {candles:read(),error:previous.error};
    const task=(async()=>{let error:string|null=null;try{
      const cap=minutes===60?1000:500;let before=end;
      // 初次补齐所需窗口；即使上游每页少于请求数，也以最早时间继续翻页。
      for(let page=0;page<8&&!this.stopped;page++){
        const remaining=Math.min(cap,Math.ceil((before-from)/(minutes*60000)));
        if(remaining<=0)break;
        const candles=await this.load(m,minutes,remaining,before);
        if(this.stopped)break;
        const valid=candles.filter(c=>c.closed&&c.startTime<before&&c.startTime>=from&&c.startTime%(minutes*60000)===0&&Number(c.close)>0);
        if(!valid.length)break;
        this.db.transaction(()=>{const write=this.db.prepare('INSERT INTO candle_cache VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(symbol,interval,start_time) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume');for(const c of valid)write.run(symbol,interval,c.startTime,c.open,c.high,c.low,c.close,c.volume);})();
        const earliest=Math.min(...valid.map(c=>c.startTime));if(earliest>=before)break;before=earliest;
        if(read().length>=cap)break;
      }
      this.db.prepare('DELETE FROM candle_cache WHERE symbol=? AND interval=? AND start_time NOT IN (SELECT start_time FROM candle_cache WHERE symbol=? AND interval=? ORDER BY start_time DESC LIMIT ?)').run(symbol,interval,symbol,interval,cap);
    }catch{error=`${m.venue} ${m.nativeSymbol} 历史查询失败`;}
    this.fetched.set(key,{at:this.now(),error});if(this.fetched.size>200)this.fetched.delete(this.fetched.keys().next().value!);
    return {candles:read(),error};})();
    this.pending.set(key,task);try{return await task;}finally{this.pending.delete(key);}
  }
  async query(a:ObservationMarket,b:ObservationMarket,hours:number,referenceHours:number,intervalMinutes:number,force=false,before?:number):Promise<ObservationHistory>{
    const at=this.now(),chartMinutes=intervalMinutes===10080?1440:intervalMinutes;
    if(a.quote!=='USDT'||b.quote!=='USDT')throw new Error('黄金历史仅支持 USDT 报价市场');
    const issues=new Set<string>();
    let chartFrom=0, chartAvailable=false;
    const pair=async(minutes:number,windowHours:number,isChart=false)=>{
      const step=minutes*60000,end=Math.floor((isChart&&before!==undefined?Math.min(before,at):at)/step)*step,rawFrom=Math.max(0,end-windowHours*3600000),from=isChart&&intervalMinutes===10080?Math.max(0,Math.floor((rawFrom-4*86400000)/(7*86400000))*7*86400000+4*86400000):rawFrom;
      if(isChart)chartFrom=from;
      const legs=[a,b];
      const loaded=await Promise.all(legs.map(async m=>{
        if(!isChart||before===undefined)return this.series(m,minutes,from,force);
        // 更早分页仅返回浏览器，不挤占当前行情的有界数据库缓存。
        const candles:Candle[]=[];let cursor=end;
        for(let page=0;page<8&&cursor>from&&!this.stopped;page++){
          const rows=(await this.load(m,minutes,Math.min(500,Math.ceil((cursor-from)/step)),cursor)).filter(c=>c.closed&&c.startTime>=from&&c.startTime<cursor&&c.startTime%step===0);
          if(!rows.length)break; candles.push(...rows);cursor=Math.min(...rows.map(c=>c.startTime));
        }
        return {candles,error:null};
      }));
      if(isChart)chartAvailable=loaded.every(r=>r.candles.length>0&&!r.error);
      if(before!==undefined&&this.stopped)throw new Error('历史加载已停止');
      loaded.forEach(r=>{if(r.error)issues.add(r.error);});
      const maps=loaded.map(r=>new Map(r.candles.map(c=>[c.startTime,c.close])));
      const points:ObservationHistory['points']=[];
      for(const [time,close] of maps[0]){const other=maps[1].get(time);if(!other)continue;const left=new Decimal(close),right=new Decimal(other);
        points.push({time,value:left.div(right).minus(1).mul(100).toNumber(),leftClose:left.toNumber(),rightClose:right.toNumber()});}
      return points.sort((x,y)=>x.time-y.time);
    };
    const [chart,baseline]=await Promise.all([pair(chartMinutes,hours,true),before===undefined?pair(60,referenceHours):Promise.resolve([])]);
    const intervalMs=intervalMinutes*60000,buckets=new Map<number,ObservationHistory['points'][number]>();
    for(const p of chart){const key=Math.floor((p.time-(intervalMinutes===10080?4*86400000:0))/intervalMs);buckets.set(key,p);}
    const points=[...buckets.values()],latestAt=baseline.at(-1)?.time??null,coverage=baseline.length/referenceHours;
    const fresh=latestAt!==null&&Math.floor(at/3600000)*3600000-latestAt<=3600000;
    const meanPct=baseline.length?baseline.reduce((sum,p)=>sum.plus(p.value),new Decimal(0)).div(baseline.length).toNumber():null;
    return {nextBefore:chartFrom>0?chartFrom:null,hasMore:chartAvailable&&chartFrom>0,points,sampleCount:chart.length,intervalMs,startedAt:chart[0]?.time??null,
      reference:{hours:referenceHours,meanPct,minPct:baseline.length?Math.min(...baseline.map(p=>p.value)):null,maxPct:baseline.length?Math.max(...baseline.map(p=>p.value)):null,sampleCount:baseline.length,expectedSamples:referenceHours,coverage,latestAt,fresh,sufficient:coverage>=.9&&fresh},
      source:'exchange_candles',loadedAt:at,quote:'USDT',referenceIntervalMs:3600000,
      warning:[...issues,before===undefined&&coverage<.9?'交易所历史覆盖不足，均值仅供观察。':''].filter(Boolean).join(' ')||null};
  }
}
