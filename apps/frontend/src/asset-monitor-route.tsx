import { useCallback, memo, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_GOLD_ALERT_SETTINGS, GoldAlertSettingsSchema, type GoldAlertSettings, OBSERVATION_VENUES, observationDirectionEligible, observationPaymentAllowed, type ObservationSnapshot, type ObservationSettings, type ObservationHistory, type GoldQuote, type StableDirection } from '@gate-crossex/shared-types';
import { api } from './api.js';
import './asset-monitor.css';
import { useLanguage } from './i18n.js';
import { PREMIUM_MOVING_AVERAGE_STYLES, PREMIUM_HISTORY_TIMEFRAMES, type PremiumHistoryTimeframe, type PremiumHistoryPoint } from './premium-history.js';
import { splitHistorySegments } from './history-segments.js';
import { spreadTradeLink } from './spread-trade-link.js';

const PremiumHistoryChart = lazy(() => import('./charts.js').then(module => ({ default: module.PremiumHistoryChart })));


const venueName=(v:string)=>({GATE:'Gate',BINANCE:'Binance',OKX:'OKX',BYBIT:'Bybit',KRAKEN:'Kraken',HYPERLIQUID:'Hyperliquid'}[v]??v);
const number=(v:string|number|null|undefined,digits=4)=>v==null?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:digits});
const usd=(v:number|null|undefined)=>v==null?'—':`${new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:2}).format(v)} USD`;
const bps=(v:number|null|undefined)=>v==null?'—':`${v>=0?'+':''}${v.toFixed(2)} bps`;
const pct=(v:number|null)=>v===null?'—':`${v>=0?'+':''}${v.toFixed(3)}%`;
const stableAttention=(r:StableDirection,settings:ObservationSettings)=>r.status==='discount'&&observationDirectionEligible(r,settings);
const stableStatus=(r:StableDirection,settings:ObservationSettings)=>{
  if(r.status==='stale')return '行情不可用';
  if(r.status!=='discount')return '正常';
  if(!observationPaymentAllowed(r.pay,settings))return '仅观察 · 无可用支付币';
  if(!settings.bidirectional&&r.inverse)return '仅观察 · 未启用反向';
  if(!observationDirectionEligible(r,settings))return '仅观察 · 金额不足';
  return '可提醒折价';
};
const label=(g:GoldQuote)=>`${venueName(g.market.venue)} · ${g.market.base} · ${g.market.product==='spot'?'现货':'永续'} · ${g.market.venue==='HYPERLIQUID'&&g.market.nativeSymbol==='PAXG'?'USDC保证金 · USDT计价':g.market.quote}`;
function GoldMarketLink({gold,children}:{gold:GoldQuote;children:ReactNode}){
  const {venue,base,quote,nativeSymbol}=gold.market;
  const href=spreadTradeLink(`${venue}_FUTURE_${base}_${quote}`,nativeSymbol);
  return href?<a className="ao-market-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={`打开 ${venueName(venue)} ${nativeSymbol} 永续市场`} title={`在新标签页打开 ${venueName(venue)} ${nativeSymbol} 永续市场`}>{children}<span aria-hidden="true"> ↗</span></a>:<span>{children}</span>;
}
function useObservation(){
  const [data,setData]=useState<ObservationSnapshot|null>(null),[error,setError]=useState(''),[clock,setClock]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{let stopped=false;let timer:ReturnType<typeof setTimeout>;const load=async()=>{try{const result=await api.assetObservation();if(!stopped){setData(result);setError('');}}catch{if(!stopped)setError('后端连接失败，停止实时判断；正在重试。');}finally{if(!stopped){setClock(Date.now());timer=setTimeout(()=>void load(),1000);}}};void load();return()=>{stopped=true;clearTimeout(timer);};},[]);
  return {data,setData,error,clock};
}
export function AssetMonitorView(){
  const {data,setData,error,clock}=useObservation();const [tab,setTab]=useState<'stable'|'gold'>('stable');const [settingsOpen,setSettingsOpen]=useState(false);
  const [query,setQuery]=useState(''),[venue,setVenue]=useState('all'),[only,setOnly]=useState(false),[detail,setDetail]=useState<StableDirection|null>(null);
  const [sort,setSort]=useState(true);const [scope,setScope]=useState('both'),[inverse,setInverse]=useState(true);
  const initialized=useRef(false);useEffect(()=>{if(data&&!initialized.current){initialized.current=true;setScope(data.settings.paymentCoins);setInverse(data.settings.bidirectional);}},[data]);
  const stable=useMemo(()=>{
    if(!data)return [];
    return data.stable.map(r=>({...r,status:error||clock-r.observedAt>data.staleMs?'stale' as const:r.status}))
      .filter(r=>(inverse||!r.inverse)&&(scope==='all'||(scope==='both'?['USDT','USDC'].includes(r.pay):r.pay===scope))&&(venue==='all'||r.venue===venue)&&(!only||stableAttention(r,data.settings))&&`${r.buy}/${r.pay}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a,b)=>Number(a.status==='stale')-Number(b.status==='stale')||Number(stableAttention(b,data.settings))-Number(stableAttention(a,data.settings))||(sort?Number(a.price)-Number(b.price):Number(b.price)-Number(a.price)));
  },[data,error,clock,inverse,scope,venue,only,query,sort]);
  const selectedDetail=detail?stable.find(r=>r.id===detail.id)??null:null;
  return <div className="asset-observer"><div className="ao-heading"><div><small>策略 / 公开行情观察</small><h1>稳定币与黄金监控</h1><p>稳定币观察相对折价；黄金观察同所／跨所永续价差及其历史偏离，不自动交易。</p></div><span className="ao-status">{error?'连接中断':data?.updatedAt?`更新于 ${new Date(data.updatedAt).toLocaleTimeString()}`:'正在发现市场'}<small>后台采集 · 黄金轮询间隔 {data?data.pollingMs/1000:2} 秒 · 稳定币至少间隔 10 秒</small></span></div>
    <div className="ao-tabs"><button className={tab==='stable'?'active':''} onClick={()=>setTab('stable')}>稳定币交易对</button><button className={tab==='gold'?'active':''} onClick={()=>setTab('gold')}>黄金价差观察</button>{<button className="ao-right" disabled={!data} onClick={()=>setSettingsOpen(true)}>提醒设置</button>}</div>
    {error&&<p role="alert" className="ao-warning">{error}</p>}
    {!data?<div role="status" className="ao-empty">正在加载监控数据…</div>:<>
      <details className="ao-coverage"><summary>行情覆盖 · {data.sources.filter(s=>!s.error).length}/{data.sources.length||12} 个现货／永续数据源 {data.sources.some(s=>s.error)?<span className="ao-source-error">部分来源不可用</span>:'查看状态'}</summary><div className="ao-source-grid">{[...data.sources].sort((a,b)=>OBSERVATION_VENUES.indexOf(a.venue)-OBSERVATION_VENUES.indexOf(b.venue)).map(s=><div key={`${s.venue}:${s.product}`} className={s.error?'ao-source-error':undefined}><b>{venueName(s.venue)} · {s.product==='spot'?'现货':'黄金永续'}</b><small>{s.count} 个匹配市场 · {s.error??(s.count?'正常':'未发现适用市场')}</small></div>)}</div><p>按维护的资产名单匹配实时市场目录；不把名称带 USD 的普通资产自动归为稳定币。Hyperliquid 现货结合 canonical 目录与已核实 tokenId 名单，排除未识别的同名代币。目录每小时更新。</p><small>当前名单：{data.registry.join('、')}。黄金只覆盖 USDT 报价的 PAXG、XAUT、XAU 永续合约，ETF 与收益凭证不混入。</small></details>
      {tab==='stable'?<><div className="ao-toolbar"><label>支付币<select aria-label="支付币范围" value={scope} onChange={e=>setScope(e.target.value)}><option value="both">USDT + USDC</option><option value="USDT">仅 USDT</option><option value="USDC">仅 USDC</option><option value="all">全市场观察</option></select></label><label>交易所<select value={venue} onChange={e=>setVenue(e.target.value)}><option value="all">全部</option>{OBSERVATION_VENUES.map(v=><option key={v} value={v}>{venueName(v)}</option>)}</select></label><label>搜索<input placeholder="币种或交易对" value={query} onChange={e=>setQuery(e.target.value)}/></label><label className="ao-check"><input type="checkbox" checked={inverse} onChange={e=>setInverse(e.target.checked)}/>双向扫描</label><label className="ao-check"><input type="checkbox" checked={only} onChange={e=>setOnly(e.target.checked)}/>只看可提醒折价</label></div>
      <div className="ao-strip"><b>{stable.length} 个方向</b><span>{stable.filter(r=>stableAttention(r,data.settings)).length} 个可提醒折价</span><small>仅配置的支付币、足额第一档进入标红与提醒；全市场观察保留其他价差。列表筛选不修改后台规则。</small></div>
      <div className="ao-scroll"><table><thead><tr><th>买入币 / 支付币</th><th title="买入币的流通市值与全市场24小时成交额，CoinGecko统计，单位USD。">市值 / 24h成交额</th><th>交易所 / 原始市场</th><th><button onClick={()=>setSort(!sort)}>买入价 {sort?'↑':'↓'}</button></th><th>偏离 1∶1</th><th title="以支付币计价，仅统计当前最优一档，未含手续费。">当前价可买金额</th><th title="累计买入价≤0.998的挂单，以支付币计价，未含手续费。≥表示接口档位不足，仅为已取得深度的下限。">买到 0.998 的深度</th><th>状态 / 连续时间</th><th/></tr></thead><tbody>{stable.map(r=><tr key={r.id} className={stableAttention(r,data.settings)?'ao-discount-row':undefined}><td><b>{r.buy} / {r.pay}</b><small>买 {r.buy} · 付 {r.pay}</small></td><td title={`买入币 ${r.buy} · CoinGecko 全市场统计${r.marketStats?` · 更新于 ${new Date(r.marketStats.updatedAt).toLocaleString()}`:" · 暂无有效数据"}`}><span>市值 {usd(r.marketStats?.marketCapUsd)}</span><small>24h {usd(r.marketStats?.volume24hUsd)}</small></td><td>{venueName(r.venue)}<small>{r.nativeSymbol} · {r.inverse?'反向':'正向'}</small></td><td className={stableAttention(r,data.settings)?'ao-negative':''}>{r.status==='stale'?'—':number(r.price,6)}<small>{r.pay} / 枚</small></td><td>{r.status==='stale'?'—':pct(Number(r.price)*100-100)}</td><td>{r.status==='stale'?'—':number(r.payAmount,2)}<small>{r.pay}</small></td><td title={r.depthTo0998?`可买 ${number(r.depthTo0998.buyAmount,6)} ${r.buy} · ${r.depthTo0998.levels} 档${r.depthTo0998.complete?'':' · 档位未覆盖至限价，仅为下限'}`:'暂无有效深度'}>{r.status==='stale'||!r.depthTo0998?'—':`${r.depthTo0998.complete?'':'≥ '}${number(r.depthTo0998.payAmount,2)}`}<small>{r.pay}{r.depthTo0998&&!r.depthTo0998.complete?' · 已取深度下限':''}</small></td><td className={stableAttention(r,data.settings)?'ao-negative':''}>{stableStatus(r,data.settings)}<small>{stableAttention(r,data.settings)?`${r.durationSeconds} 秒（后台选中方向）`:r.observedAt?new Date(r.observedAt).toLocaleTimeString():'等待采集'}</small></td><td><button onClick={()=>setDetail(r)}>详情</button></td></tr>)}</tbody></table>{!stable.length&&<div className="ao-empty">{data.updatedAt?'没有匹配的有效市场目录，请调整筛选或查看来源状态。':'正在发现市场，首次采集可能需要数十秒。'}</div>}</div>
      <p className="ao-note">市值与24h成交额：买入币的全市场数据（CoinGecko），每10分钟更新，缺失或超过30分钟显示“—”。{data.marketStatsError&&<span className="ao-source-error"> 数据源更新失败，正在重试。</span>}</p><p className="ao-note">只比较真实交易对；反向买入价为原买一价的倒数。标红与提醒只针对配置的支付币且第一档达到金额门槛；仅观察价差不触发提醒。相对折价不等于已确定某币脱锚，不包含手续费。</p>
      </>:<GoldObservation data={data} clock={clock} disconnected={!!error}/>}
      <details className="ao-events"><summary>异常记录与通知 · 最近 {data.events.length} 条</summary>{data.events.map(e=><p key={e.id}><small>{new Date(e.createdAt).toLocaleString()} · {{recorded:'仅记录',pending:'发送中',sent:'Bark 已接收',failed:'发送失败',unknown:'发送结果未知'}[e.status]}</small>{e.message}</p>)}</details>
    </>}
    {settingsOpen&&data&&tab==='stable'&&<ObservationSettingsDialog settings={data.settings} configured={data.barkConfigured} onClose={()=>setSettingsOpen(false)} onSave={async next=>{const result=await api.saveAssetObservation(next);setData(result);setSettingsOpen(false);}}/>}
    {settingsOpen&&data&&tab==='gold'&&<GoldSettingsDialog settings={data.goldSettings??DEFAULT_GOLD_ALERT_SETTINGS} configured={data.barkConfigured} onClose={()=>setSettingsOpen(false)} onSave={async next=>{setData(await api.saveGoldObservation(next));setSettingsOpen(false);}}/>}
    {detail&&<Dialog title={`${detail.buy} / ${detail.pay}`} onClose={()=>setDetail(null)}><p>{venueName(detail.venue)} · {detail.nativeSymbol}</p><h2>{selectedDetail?.status==='stale'||!selectedDetail?'行情不可用':`${number(selectedDetail.price,6)} ${detail.pay} / 枚`}</h2><p>{detail.inverse?'反向买入：1 ÷ 原始市场买一价。实际为卖出原交易对的基础币，获得报价币。':'正向买入：原始市场卖一价。'}</p><p>当前价可买金额：{selectedDetail?.status==='stale'?'—':number(selectedDetail?.payAmount,2)} {detail.pay}</p><p className="ao-note">以支付币计价，仅统计当前最优一档，未含手续费。</p><p>买到 0.998 的深度：{selectedDetail?.status==='stale'||!selectedDetail?.depthTo0998?'—':`${selectedDetail.depthTo0998.complete?'':'≥ '}${number(selectedDetail.depthTo0998.payAmount,2)} ${detail.pay}`}</p><p className="ao-note">累计买入价不超过 0.998 的挂单，未含手续费。≥ 表示接口档位尚未覆盖至限价，仅展示已取得深度的下限；不是平均成交价达到 0.998。</p><p className="ao-note">{selectedDetail?stableStatus(selectedDetail,data!.settings):'行情不可用'}。这是交易对之间的相对价格，不能仅凭这一笔报价确定哪枚资产偏离美元。</p></Dialog>}
  </div>;
}
function Dialog({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);return <dialog ref={ref} className="ao-dialog" onCancel={onClose}><div className="ao-dialog-head"><h2>{title}</h2><button onClick={onClose} aria-label="关闭">×</button></div>{children}</dialog>;}
function GoldSettingsDialog({settings,configured,onClose,onSave}:{settings:GoldAlertSettings;configured:boolean;onClose:()=>void;onSave:(s:GoldAlertSettings)=>Promise<void>}){
 const [draft,setDraft]=useState({...settings,notificationsEnabled:configured&&settings.notificationsEnabled}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const fields=[['thresholdBps','可成交毛价差大于（bps）',0.01,10000,0.01],['durationSeconds','触发持续时间（秒）',1,86400,1],['recoveryBps','恢复价差低于（bps）',0,10000,0.01],['recoverySeconds','恢复持续时间（秒）',1,86400,1]] as const;
 return <Dialog title="黄金提醒设置" onClose={onClose}><form onSubmit={e=>{e.preventDefault();const parsed=GoldAlertSettingsSchema.safeParse(draft);if(!parsed.success){setError('请检查数值范围，恢复阈值必须小于触发阈值。');return;}setBusy(true);setError('');void onSave(parsed.data).catch(()=>setError('保存失败，请检查网络及 Bark 配置。')).finally(()=>setBusy(false));}}>
   {fields.map(([field,label,min,max,step])=><label key={field}>{label}<input type="number" required min={min} max={max} step={step} disabled={busy} value={Number.isNaN(draft[field])?'':draft[field]} onChange={e=>setDraft({...draft,[field]:e.target.value===''?NaN:Number(e.target.value)})}/></label>)}
   <label><input type="checkbox" disabled={!configured||busy} checked={draft.notificationsEnabled} onChange={e=>setDraft({...draft,notificationsEnabled:e.target.checked})}/>Bark 手机提醒 {configured?'':'（未配置 BARK_DEVICE_KEY）'}</label>
   <p className="ao-note">全部跨所黄金永续组合双方向监控。价差按卖出腿买一 ÷ 买入腿卖一 − 1 计算，100 bps = 1%。同一轮超限只提醒一次；降到恢复阈值以下并持续满足恢复时间后重新布防。数据中断会重置连续计时，不视为恢复。修改设置后重新计时；关闭 Bark 后仍记录事件。设置独立于稳定币提醒。</p>
   {error&&<p role="alert">{error}</p>}<button disabled={busy}>{busy?'保存中…':'保存设置'}</button>
 </form></Dialog>;
}
function ObservationSettingsDialog({settings,configured,onClose,onSave}:{settings:ObservationSettings;configured:boolean;onClose:()=>void;onSave:(s:ObservationSettings)=>Promise<void>}){
 const [draft,setDraft]=useState(settings),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <Dialog title="稳定币提醒设置" onClose={onClose}><form onSubmit={e=>{e.preventDefault();setBusy(true);setError('');void onSave(draft).catch(()=>setError('保存失败，请检查阈值、持续时间及 Bark 配置。')).finally(()=>setBusy(false));}}><label>买入价低于<input type="number" min="0.5" max="0.999999" step="0.000001" required value={draft.threshold} onChange={e=>setDraft({...draft,threshold:e.target.value})}/></label><label>持续时间（秒）<input type="number" min="10" max="86400" required value={draft.durationSeconds} onChange={e=>setDraft({...draft,durationSeconds:Number(e.target.value)})}/></label><label>可用支付币（参与提醒）<select value={draft.paymentCoins} onChange={e=>setDraft({...draft,paymentCoins:e.target.value as ObservationSettings['paymentCoins']})}><option value="both">USDT + USDC</option><option value="USDT">USDT</option><option value="USDC">USDC</option></select></label><label><input type="checkbox" checked={draft.bidirectional} onChange={e=>setDraft({...draft,bidirectional:e.target.checked})}/>双向监控</label><label>第一档最低可买金额<input type="number" min="0" max="1000000000" step="1" required value={draft.minPayAmount} onChange={e=>setDraft({...draft,minPayAmount:Number(e.target.value)})}/></label><label><input type="checkbox" disabled={!configured} checked={draft.notificationsEnabled} onChange={e=>setDraft({...draft,notificationsEnabled:e.target.checked})}/>Bark 手机提醒 {configured?'':'（未配置 BARK_DEVICE_KEY）'}</label><p className="ao-note">后端运行时持续采集。每个事件记录一次；只有支付币属于可用币种、且当前价第一档达到金额门槛，才累计并提醒。金额单位为该方向的支付币；此设置不读取账户真实余额。价格恢复至阈值 + 0.001 并保持 30 秒后才重新触发。数据中断会重置连续计时，不被当作恢复。</p>{error&&<p role="alert">{error}</p>}<button disabled={busy}>{busy?'保存中…':'保存设置'}</button></form></Dialog>;
}

type GoldPair = { a:GoldQuote; b:GoldQuote; key:string };
type PairSort = 'mean'|'spread'|'min'|'max'|'range'|'deviation';
function GoldPairOverview({markets,clock,staleMs,disconnected,direction,referenceHours,selectedKey,onSelect}:{markets:GoldQuote[];clock:number;staleMs:number;disconnected:boolean;direction:'expand'|'shrink';referenceHours:number;selectedKey:string;onSelect:(pair:GoldPair)=>void}){
 const [query,setQuery]=useState(''),[sort,setSort]=useState<{field:PairSort;ascending:boolean}>({field:'deviation',ascending:false});
 const [references,setReferences]=useState<Record<string,ObservationHistory['reference']|null>>({});
 const cache=useRef(new Map<string,ObservationHistory['reference']|null>());
 const referenceLabel=referenceHours===24?'24小时':`${referenceHours/24}天`;
 const signature=JSON.stringify(markets.map(g=>[g.market.id,g.market.venue]));
 const pairIds=useMemo(()=>{
   const items=JSON.parse(signature) as [string,string][];
   const result:{aId:string;bId:string;key:string}[]=[];
   for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
     if(items[i][1]!==items[j][1])result.push({aId:items[i][0],bId:items[j][0],key:`${items[i][0]}:${items[j][0]}`});
   }
   return result;
 },[signature]);
 const byId=new Map(markets.map(g=>[g.market.id,g]));
 const pairs:GoldPair[]=pairIds.map(pair=>({a:byId.get(pair.aId)!,b:byId.get(pair.bId)!,key:pair.key}));
 useEffect(()=>{
   let cancelled=false,next=0;
   setReferences(Object.fromEntries(pairIds.filter(p=>cache.current.has(`${referenceHours}:${p.key}`)).map(p=>[`${referenceHours}:${p.key}`,cache.current.get(`${referenceHours}:${p.key}`)!])));
   const missing=pairIds.filter(p=>!cache.current.has(`${referenceHours}:${p.key}`));
   const worker=async()=>{
     while(!cancelled&&next<missing.length){
       const pair=missing[next++];
       try{
         const result=await api.assetObservationHistory(pair.aId,pair.bId,1,referenceHours,60);
         if(cancelled)return;
         cache.current.set(`${referenceHours}:${pair.key}`,result.reference);
         setReferences(current=>({...current,[`${referenceHours}:${pair.key}`]:result.reference}));
       }catch{
         if(cancelled)return;
         cache.current.set(`${referenceHours}:${pair.key}`,null);
         setReferences(current=>({...current,[`${referenceHours}:${pair.key}`]:null}));
       }
     }
   };
   void Promise.all(Array.from({length:Math.min(3,missing.length)},()=>worker()));
   return()=>{cancelled=true;};
 },[pairIds,referenceHours]);
 const currentSpread=(pair:GoldPair)=>{
   const {a,b}=pair;
   if(disconnected||!a.ready||!b.ready||a.normalizedAt==null||b.normalizedAt==null||clock-a.normalizedAt>staleMs||clock-b.normalizedAt>staleMs||Math.abs(a.normalizedAt-b.normalizedAt)>10000)return null;
   return (Number(direction==='expand'?a.ask:a.bid)/Number(direction==='expand'?b.bid:b.ask)-1)*100;
 };
 const value=(pair:GoldPair,field:PairSort)=>{
   if(field==='spread'){
     const spread=currentSpread(pair);
     return spread===null?null:spread*100;
   }
   const reference=references[`${referenceHours}:${pair.key}`];
   if(!reference)return null;
   if(field==='deviation'){
     const spread=currentSpread(pair);
     return spread!==null&&reference.meanPct!==null&&reference.fresh?(spread-reference.meanPct)*100:null;
   }
   if(field==='range')return reference.minPct==null||reference.maxPct==null?null:(reference.maxPct-reference.minPct)*100;
   const percent=field==='mean'?reference.meanPct:field==='min'?reference.minPct:reference.maxPct;
   return percent==null?null:percent*100;
 };
 const shown=pairs.filter(pair=>`${label(pair.a)} ${label(pair.b)}`.toLowerCase().includes(query.toLowerCase())).sort((x,y)=>{
   const a=value(x,sort.field),b=value(y,sort.field);
   return (a===null?1:0)-(b===null?1:0)||(a===null||b===null?0:sort.ascending?a-b:b-a)||x.key.localeCompare(y.key);
 });
 const heading=(field:PairSort,title:string)=><button className="ao-sort" aria-label={`按${title}${sort.field===field&&sort.ascending?'降序':'升序'}排序`} aria-sort={sort.field===field?(sort.ascending?'ascending':'descending'):undefined} onClick={()=>setSort(current=>({field,ascending:current.field===field?!current.ascending:true}))}>{title} {sort.field===field?(sort.ascending?'↑':'↓'):'↕'}</button>;
 const loaded=pairs.filter(pair=>Object.hasOwn(references,`${referenceHours}:${pair.key}`)).length;
 return <section className="ao-panel"><div className="ao-section-head"><div><h2>跨所黄金永续价差组合</h2><small>{referenceLabel}历史价差概览 · {loaded}/{pairs.length} 组已加载</small></div><input aria-label="搜索黄金组合" placeholder="搜索交易所或标的" value={query} onChange={e=>setQuery(e.target.value)}/></div>
   <div className="ao-scroll"><table className="ao-pair-table"><thead><tr><th>A 市场 / B 市场</th><th>{heading('mean',`${referenceLabel}历史均值`)}</th><th title="随当前价差方向和实时盘口更新；两腿行情不同步或过期时显示—">{heading('spread','当前价差')}</th><th>{heading('deviation','当前较均值')}</th><th>{heading('min',`${referenceLabel}最低`)}</th><th>{heading('max',`${referenceLabel}最高`)}</th><th title={`${referenceLabel}最高历史价差减去${referenceLabel}最低历史价差`}>{heading('range','最高－最低')}</th><th>基准状态</th><th>历史覆盖</th><th>均值样本</th><th>操作</th></tr></thead><tbody>{shown.map(pair=>{
     const reference=references[`${referenceHours}:${pair.key}`],pending=!Object.hasOwn(references,`${referenceHours}:${pair.key}`);
     const status=pending?'加载中':!reference?'查询失败':reference.meanPct===null?'等待历史样本':!reference.fresh?'历史基准过期':reference.sufficient?'样本充分':'样本不足 · 临时均值';
     const range=value(pair,'range');
     return <tr key={pair.key} className={selectedKey===pair.key?'ao-pair-selected':undefined}><td><b><GoldMarketLink gold={pair.a}>{venueName(pair.a.market.venue)} · {pair.a.market.base}</GoldMarketLink></b><small>A · {pair.a.market.nativeSymbol} / {pair.a.market.quote}</small><b><GoldMarketLink gold={pair.b}>{venueName(pair.b.market.venue)} · {pair.b.market.base}</GoldMarketLink></b><small>B · {pair.b.market.nativeSymbol} / {pair.b.market.quote}</small></td><td>{bps(value(pair,'mean'))}</td><td>{bps(value(pair,'spread'))}</td><td>{bps(value(pair,'deviation'))}</td><td>{bps(value(pair,'min'))}</td><td>{bps(value(pair,'max'))}</td><td>{range===null?'—':`${range.toFixed(2)} bps`}</td><td>{status}</td><td>{reference?`${(reference.coverage*100).toFixed(1)}%`:'—'}</td><td>{reference?`${reference.sampleCount} / ${reference.expectedSamples}`:'—'}</td><td><button onClick={()=>onSelect(pair)} aria-label={`观察 ${venueName(pair.a.market.venue)} ${pair.a.market.base} 和 ${venueName(pair.b.market.venue)} ${pair.b.market.base}`}>观察</button></td></tr>;
   })}</tbody></table>{!shown.length&&<div className="ao-empty">{pairs.length?'没有匹配的组合，请调整搜索。':'暂无跨交易所的黄金永续组合。'}</div>}</div>
   <p className="ao-note">每组 A/B 按表中顺序计算；仅比较 USDT 报价黄金永续，不做汇率换算。当前价差及当前较均值沿用上方“价差方向”的实时盘口口径；当前价差随行情更新，行情过期或两腿不同步时显示“—”。历史统计跟随上方历史均值窗口，使用已收盘的同步小时 K 线；缺失或过期时显示“—”，不参与排序。点击“观察”会同时选择 A 和 B。</p></section>;
}

function GoldObservation({data,clock,disconnected}:{data:ObservationSnapshot;clock:number;disconnected:boolean}){
 const goldSettings=data.goldSettings??DEFAULT_GOLD_ALERT_SETTINGS;
 const [direction,setDirection]=useState<'expand'|'shrink'>('shrink');
 const [aVenue,setAVenue]=useState('BINANCE'),[bVenue,setBVenue]=useState('GATE'),[referenceHours,setReferenceHours]=useState(168),[aId,setA]=useState(''),[bId,setB]=useState(''),[timeframe,setTimeframe]=useState<PremiumHistoryTimeframe>('5m');
 const [historyEntry,setHistoryEntry]=useState<{key:string;data:ObservationHistory}|null>(null),[historyError,setHistoryError]=useState(''),[loading,setLoading]=useState(false);
 const [olderError,setOlderError]=useState(''),[olderLoading,setOlderLoading]=useState(false);
 const olderPending=useRef(new Set<string>());
 const referenceCache=useRef(new Map<string,ObservationHistory['reference']>());
 const historyCache=useRef(new Map<string,ObservationHistory>());
 const all=data.gold.filter(g=>g.market.product==='perpetual').sort((x,y)=>Number(x.market.quote!=='USDT')-Number(y.market.quote!=='USDT')||x.market.id.localeCompare(y.market.id));
 const left=all.filter(g=>g.market.venue===aVenue),right=all.filter(g=>g.market.venue===bVenue);
 const a=left.find(g=>g.market.id===aId)??left[0],b=right.find(g=>g.market.id===bId&&g.market.id!==a?.market.id)??right.find(g=>g.market.base===a?.market.base&&g.market.id!==a?.market.id)??right.find(g=>g.market.id!==a?.market.id);

 const timeframeConfig=PREMIUM_HISTORY_TIMEFRAMES.find(t=>t.label===timeframe)!;
 const intervalMinutes=({ '1m':1,'5m':5,'15m':15,'1H':60,'4H':240,'1D':1440,'1W':10080 } as const)[timeframe];
 const hours=Math.ceil(timeframeConfig.visibleDurationMs/3600000);
 const requestHours=Math.ceil(timeframeConfig.requestLimit*(intervalMinutes===10080?1440:intervalMinutes)/60);
 const aKey=a?.market.id,bKey=b?.market.id;
 // 首次选中后固定市场身份，不能随并发盘口返回顺序变化。
 useEffect(()=>{if(aKey&&!aId)setA(aKey);if(bKey&&!bId)setB(bKey);},[aKey,bKey,aId,bId]);
 const referenceKey=`${aKey}:${bKey}:${referenceHours}`;
 const historyKey=`${aKey}:${bKey}:${hours}:${referenceHours}:${intervalMinutes}`;
 const history=historyEntry?.key===historyKey?historyEntry.data:null;
 useEffect(()=>{
   setHistoryError('');setOlderError('');setOlderLoading(false);if(!aKey||!bKey){setLoading(false);return;}
   const cached=historyCache.current.get(historyKey);
   if(cached){setHistoryEntry({key:historyKey,data:cached});setLoading(false);return;}
   let cancelled=false;setLoading(true);
   void api.assetObservationHistory(aKey,bKey,requestHours,referenceHours,intervalMinutes).then(result=>{
     if(result.reference.sampleCount>0&&!referenceCache.current.has(referenceKey)){
       referenceCache.current.set(referenceKey,result.reference);
       if(referenceCache.current.size>40)referenceCache.current.delete(referenceCache.current.keys().next().value!);
     }
     historyCache.current.set(historyKey,result);if(historyCache.current.size>40)historyCache.current.delete(historyCache.current.keys().next().value!);
     if(!cancelled)setHistoryEntry({key:historyKey,data:result});
   }).catch(()=>{if(!cancelled)setHistoryError('交易所历史查询失败，请重新进入页面重试。');}).finally(()=>{if(!cancelled)setLoading(false);});
   return()=>{cancelled=true;};
 },[aKey,bKey,requestHours,referenceHours,intervalMinutes,historyKey,referenceKey]);
 const activeKey=useRef(historyKey);activeKey.current=historyKey;
 const loadOlder=useCallback(()=>{
   const cursor=history?.nextBefore;
   if(!aKey||!bKey||!history?.hasMore||cursor==null||loading||olderPending.current.has(historyKey))return;
   olderPending.current.add(historyKey);setOlderLoading(true);setOlderError('');
   void api.assetObservationHistory(aKey,bKey,requestHours,referenceHours,intervalMinutes,false,cursor).then(page=>{
     const current=historyCache.current.get(historyKey);if(!current)return;
     const merged=[...new Map([...page.points,...current.points].map(p=>[p.time,p])).values()].sort((a,b)=>a.time-b.time);
     const next={...current,points:merged,sampleCount:merged.length,startedAt:merged[0]?.time??null,nextBefore:page.nextBefore,hasMore:page.hasMore&&page.nextBefore!=null&&page.nextBefore<cursor};
     historyCache.current.set(historyKey,next);
     if(activeKey.current===historyKey)setHistoryEntry({key:historyKey,data:next});
   }).catch(()=>{if(activeKey.current===historyKey)setOlderError('更早历史加载失败，继续拖动可重试。');}).finally(()=>{
     olderPending.current.delete(historyKey);if(activeKey.current===historyKey)setOlderLoading(false);
   });
 },[aKey,bKey,history,historyKey,intervalMinutes,loading,referenceHours,requestHours]);
 const ready=(g:GoldQuote|undefined)=>!!g&&g.ready&&!disconnected&&clock-(g.normalizedAt??0)<=data.staleMs;
 const synced=ready(a)&&ready(b)&&Math.abs(a!.normalizedAt!-b!.normalizedAt!)<=10000;
 const mid=(g:GoldQuote)=>(Number(g.bid)+Number(g.ask))/2;
 const spread=synced?(Number(direction==='expand'?a!.ask:a!.bid)/Number(direction==='expand'?b!.bid:b!.ask)-1)*100:null;
 const points=history?.points??[],reference=referenceCache.current.get(referenceKey)??history?.reference,mean=reference?.meanPct??null;
 const deviation=spread!==null&&mean!==null&&reference?.fresh?(spread-mean)*100:null;
 const referenceLabel=referenceHours===24?'24小时':`${referenceHours/24}天`;
 const referenceStatus=!reference||mean===null?'等待历史样本':!reference.fresh?'历史基准过期':reference.sufficient?'样本充分':'样本不足 · 临时均值';
 const leg=(g:GoldQuote|undefined,side:'A'|'B')=>{
   const buy=(side==='A')===(direction==='expand');
   return <div className="ao-leg"><small className={buy?'ao-buy-label':'ao-sell-label'}>{buy?'买入':'卖出'} · {side}</small><select data-market aria-label={buy?'买入市场':'卖出市场'} value={g?.market.id??''} onChange={e=>{const selected=all.find(v=>v.market.id===e.target.value);if(!selected)return;if(side==='A'){setAVenue(selected.market.venue);setA(selected.market.id);}else{setBVenue(selected.market.venue);setB(selected.market.id);}}}>{OBSERVATION_VENUES.map(venue=><optgroup key={venue} label={venueName(venue)}>{all.filter(v=>v.market.venue===venue&&v.market.id!==(side==='A'?b?.market.id:a?.market.id)).map(v=><option key={v.market.id} value={v.market.id}>{label(v)}</option>)}</optgroup>)}</select><strong>{ready(g)?number(buy?g!.ask:g!.bid,3):'—'} <small>USDT / 金衡盎司 · {buy?'卖一价':'买一价'}</small></strong><small>{g?`${g.market.nativeSymbol} · ${g.conversion}`:'没有可配对的市场'}</small><small>{ready(g)?`中间价 ${number(mid(g!),3)} · 原始买一 ${number(g!.market.bid)} / 卖一 ${number(g!.market.ask)} ${g!.market.quote}`:'行情或配对不可用'}</small>{g&&<div className="ao-leg-market-link"><GoldMarketLink gold={g}>打开 {venueName(g.market.venue)} 市场</GoldMarketLink></div>}</div>;
 };

 return <><p className="ao-note">黄金告警：全部跨所组合双方向检查，卖出腿买一 ÷ 买入腿卖一 − 1 大于 {goldSettings.thresholdBps} bps（{goldSettings.thresholdBps/100}%）并连续 {goldSettings.durationSeconds} 秒触发；同一轮超限仅提醒一次，同一方向降到 {goldSettings.recoveryBps} bps 以下持续 {goldSettings.recoverySeconds} 秒后重新布防。行情中断或不同步会重置计时；切换页面方向、历史窗口或搜索不改变后台规则。{!data.barkConfigured?'Bark 未配置，目前仅记录事件。':goldSettings.notificationsEnabled?'Bark 手机提醒已开启。':'Bark 手机提醒已关闭，仅记录事件。'}</p><div className="ao-toolbar"><label>历史均值窗口<select aria-label="历史均值窗口" value={referenceHours} onChange={e=>setReferenceHours(Number(e.target.value))}>{[[24,'24小时'],[72,'3天'],[168,'7天'],[720,'30天']].map(([h,l])=><option key={h} value={h}>{l}</option>)}</select></label><span className="ao-note">仅黄金永续 · 支持同所／跨所配对 · 无自动交易</span></div>
 <div className="ao-layout"><div className="ao-main"><section className="ao-panel"><h2>买卖方向</h2><div className="ao-legs">{leg(a,'A')}<div className="ao-gap"><div className="ao-direction-status"><small>价差方向</small><b>{direction==='expand'?'价差扩大':'价差缩小'}</b><small>{direction==='expand'?'预期价差上升 ↑':'预期价差下降 ↓'}</small></div><small>当前方向价差</small><strong className={spread!==null&&spread<0?'ao-negative':''}>{bps(spread===null?null:spread*100)}</strong><small>{referenceLabel}均值 {bps(mean===null?null:mean*100)}</small><small className="ao-reference-state">{referenceStatus}</small><button aria-label="切换方向" disabled={!a||!b} onClick={()=>setDirection(v=>v==='expand'?'shrink':'expand')}>⇄</button><small>切换方向</small></div>{leg(b,'B')}</div><p className="ao-note">方向按 A/B 的有符号价差定义：扩大＝买 A 卖 B（价差上升），缩小＝卖 A 买 B（价差下降）。当前仅展示合约方向，不下单；跨所需分别准备保证金。当前方向价差：扩大用 A卖一 ÷ B买一 − 1，缩小用 A买一 ÷ B卖一 − 1，均按固定 A/B 顺序计算。盘口只代表最优一档，未扣手续费、资金费和滑点。正值表示按当前方向盘口 A 高于 B，负值表示 A 低于 B；跨币、跨产品不代表可以相互兑换。两腿采样时间差超过 10 秒暂停实时比较。</p>{!a||!b?<p className="ao-warning">所选交易所暂无可配对的黄金永续，请分别选择两侧市场或查看行情覆盖。</p>:null}</section>
 <section className="ao-panel"><div className="ao-section-head"><h2>历史溢折价</h2><div role="group" aria-label="黄金图表采样周期">{PREMIUM_HISTORY_TIMEFRAMES.map(t=><button key={t.label} aria-pressed={timeframe===t.label} className={timeframe===t.label?'active':''} onClick={()=>setTimeframe(t.label)}>{t.label}</button>)}</div></div><div className="ao-history-reading" aria-label="当前方向实时价差读数"><strong>{bps(spread===null?null:spread*100)}</strong><small>{synced?`实时 · ${new Date(Math.min(a!.normalizedAt!,b!.normalizedAt!)).toLocaleString('zh-CN')}`:'实时行情不可用'}</small></div><ObservationChart key={`${aKey}:${bKey}:${timeframe}`} seriesKey={`${aKey}:${bKey}:${timeframe}`} points={points} interval={history?.intervalMs??60000} hours={hours} loading={loading} referenceMean={mean} referenceLabel={referenceLabel} onLoadMore={loadOlder}/><p className="ao-note" role="status">{olderLoading?'正在加载更早历史…':olderError|| (history?.hasMore?'拖近左边界加载更早历史':history?'已到当前可获取历史的边界':'')}</p>{history&&<p className="ao-note">图表已加载 {points.length} 个点 · 实际数据范围：{points.length?`${new Date(points[0].time).toLocaleString()} — ${new Date(points[points.length-1].time).toLocaleString()}`:'暂无'} · 查询时间：{history.loadedAt?new Date(history.loadedAt).toLocaleString():'—'} · {history.source==='exchange_candles'?'交易所历史收盘价':'本地采样'}</p>}{history?.warning&&<p className="ao-warning">{history.warning}</p>}{historyError&&<p role="alert">{historyError}</p>}</section>
 <GoldPairOverview referenceHours={referenceHours} markets={all} clock={clock} staleMs={data.staleMs} disconnected={disconnected} direction={direction} selectedKey={`${aKey}:${bKey}`} onSelect={pair=>{setAVenue(pair.a.market.venue);setA(pair.a.market.id);setBVenue(pair.b.market.venue);setB(pair.b.market.id);}}/></div>
 <aside><section className="ao-panel"><h2>历史价差概览</h2>{[[`${referenceLabel}历史均值`,bps(mean===null?null:mean*100)],['基准状态',referenceStatus],['历史覆盖',reference?`${(reference.coverage*100).toFixed(1)}%`:'—'],['均值样本',reference?`${reference.sampleCount} / ${reference.expectedSamples}`:'—'],[`${referenceLabel}最低`,bps(reference?.minPct==null?null:reference.minPct*100)],[`${referenceLabel}最高`,bps(reference?.maxPct==null?null:reference.maxPct*100)],['当前较均值',bps(deviation)]].map(([k,v])=><div className="ao-stat" key={k}><small>{k}</small><b>{v}</b></div>)}<p className="ao-note">均值、最低、最高均按所选窗口内已收盘的同步小时K线计算，不混入当前盘口；查询时覆盖率达到90%且有最新已收盘小时线才标记充分。页面停留时基准保持本次查询快照。覆盖不足时仅作临时参考。切换图表周期或左拖加载不改变本窗口统计；极值为小时收盘溢折价极值，不是盘中瞬时极值。100 bps = 1 个百分点，不代表保证回归。</p></section><details className="ao-panel"><summary>买卖方向毛价差</summary><div className="ao-stat"><small>买 A / 卖 B</small><b>{synced?pct((Number(b!.bid)/Number(a!.ask)-1)*100):'—'}</b></div><div className="ao-stat"><small>买 B / 卖 A</small><b>{synced?pct((Number(a!.bid)/Number(b!.ask)-1)*100):'—'}</b></div><p className="ao-note">第一档卖出买一价 ÷ 买入卖一价 − 1。仅比较 USDT 报价，不做汇率换算；未扣手续费、资金费与滑点，不保证双边同时成交，未计跨所保证金占用。</p></details></aside></div></>;
}
const ObservationChart = memo(function ObservationChart({ points, interval, hours, seriesKey, loading, referenceMean, referenceLabel, onLoadMore }: { onLoadMore:()=>void; referenceMean: number | null; referenceLabel: string; points: ObservationHistory['points']; interval: number; hours: number; seriesKey: string; loading: boolean }) {
  const { theme } = useLanguage();
  const [visible, setVisible] = useState([5, 10, 20]);
  const [hovered, setHovered] = useState<PremiumHistoryPoint | null>(null);
  const [reset, setReset] = useState(0);
  const chartPoints = useMemo(() => points.map(p => ({ time: p.time, value: p.value * 100, adrClose: p.leftClose, hedgeClose: p.rightClose })), [points]);
  const movingAverages = useMemo(() => PREMIUM_MOVING_AVERAGE_STYLES.map(style => ({
    ...style,
    points: splitHistorySegments(chartPoints, interval * 1.5).flatMap(part => part.slice(style.period - 1).map((p, i) => ({
      time: p.time, value: part.slice(i, i + style.period).reduce((sum, v) => sum + v.value, 0) / style.period,
    }))),
  })), [chartPoints, interval]);
  const displayed = hovered ?? chartPoints.at(-1);
  const overlays = useMemo(() => movingAverages.filter(ma => visible.includes(ma.period)), [movingAverages, visible]);
  return <>

    <p className="ao-note">基准线：{referenceLabel}历史平均溢折价 {bps(referenceMean===null?null:referenceMean*100)}</p>
    <div className="premium-history-chart-shell">
      <div className="premium-ma-legend" aria-label="黄金溢折价均线">{movingAverages.map(ma => {
        const shown = visible.includes(ma.period);
        const point = displayed ? ma.points.find(p => p.time === displayed.time) : undefined;
        return <button key={ma.period} aria-pressed={shown} className={shown ? '' : 'hidden'} onClick={() => setVisible(v => shown ? v.filter(n => n !== ma.period) : [...v, ma.period])}>
          <i style={{background:ma.color}}/><b>MA({ma.period})</b><strong style={{color:ma.color}}>{shown ? point ? bps(point.value) : '—' : '隐藏'}</strong>
        </button>;
      })}</div>
      <Suspense fallback={<div className="premium-history-chart chart-module-loading" role="status">正在加载历史图表…</div>}>
        <PremiumHistoryChart unit=" bps" referenceValue={referenceMean===null?null:referenceMean*100} points={chartPoints} movingAverages={overlays} seriesKey={`${seriesKey}:${reset}`} visibleDurationMs={hours * 3600000}
          theme={theme} locale="zh-CN" ariaLabel="黄金真实历史溢折价" gapAfterMs={interval * 1.5}
          placeholder={loading ? '正在加载历史…' : chartPoints.length === 1 ? '交易所只返回1个同步样本' : '尚无同步历史，请查看来源提示'}
          onHover={setHovered} onLoadMore={onLoadMore}/>
      </Suspense>
    </div>
    <div className="ao-chart-help"><small>滚轮缩放 · 拖动平移 · 十字光标读数 · 数据缺口不连接</small><button onClick={() => { setHovered(null); setReset(v => v + 1); }}>回到最新</button></div>
  </>;
});
