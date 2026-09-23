// 只访问公开行情；独立记录原始帧与生产解码结果，不读取凭证、不下单。
import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { nativeSubscriptions, nativePair, nativeUrl, decodeNativeBook } from '../apps/backend/src/spread-native.ts';
const duration = Number(process.env.DIAG_SECONDS ?? 40) * 1000;
const report = { startedAt: new Date().toISOString(), durationMs: duration, connections: [], samples: [] };
const sockets = []; const timers = []; const loop = monitorEventLoopDelay({resolution:20}); loop.enable();
function connect(name,url,requests,decode) {
 const state={name,url,openedAt:null,controls:[],streams:{},decodeErrors:[],transportErrors:[]};report.connections.push(state);
 const ws=new WebSocket(url,{handshakeTimeout:15000,headers:{'X-Gate-Size-Decimal':'1'}});sockets.push(ws);
 ws.on('open',()=>{state.openedAt=Date.now();requests.forEach((m,i)=>timers.push(setTimeout(()=>ws.send(JSON.stringify(m)),i*300)));});
 ws.on('message',raw=>{const received=Date.now();if(String(raw)==='pong')return;let m;try{m=JSON.parse(String(raw));}catch{return;}
 let b;try{b=decode(m);}catch(e){if(state.decodeErrors.length<5)state.decodeErrors.push({message:e.message,frame:m});return;}
 if(!b){if(state.controls.length<12){const control={...m};delete control.conn_id;delete control.connId;delete control.trace_id;state.controls.push(control);}return;}
 const s=state.streams[b.s]??={frames:0,firstFrameDelayMs:received-state.openedAt,maxArrivalGapMs:0,maxSourceAgeMs:0,sourceAgeTotal:0,lastReceived:received,lastSourceAt:0,unchangedTimestamps:0,levels:0};
 s.frames++;s.maxArrivalGapMs=Math.max(s.maxArrivalGapMs,received-s.lastReceived);s.maxSourceAgeMs=Math.max(s.maxSourceAgeMs,received-b.ts);s.sourceAgeTotal+=received-b.ts;s.unchangedTimestamps+=Number(b.ts===s.lastSourceAt);s.lastReceived=received;s.lastSourceAt=b.ts;s.levels=Math.max(s.levels,b.a?.length??0);
 });
 ws.on('error',e=>state.transportErrors.push(e.message));ws.on('close',(code,reason)=>{state.close={code,reason:String(reason)};});
 const heartbeat=setInterval(()=>{if(ws.readyState!==1)return;ws.ping();if(name==='okx_book')ws.send('ping');},15000);timers.push(heartbeat);
}
for(const [channel,symbols] of [
 ['gate_usdt',['GATE_FUTURE_BTC_USDT','GATE_FUTURE_AAPL_USDT','GATE_FUTURE_XAU_USDT']],
 ['binance_book',['BINANCE_FUTURE_BTC_USDT','BINANCE_FUTURE_AAPL_USDT','BINANCE_FUTURE_XAUT_USDT']],
 ['okx_book',['OKX_FUTURE_BTC_USDT','OKX_FUTURE_AAPL_USDT','OKX_FUTURE_XAU_USDT']],
]){const routes=new Map(symbols.map(s=>[nativePair(s),s]));connect(channel,nativeUrl(channel),nativeSubscriptions(channel,'subscribe',symbols),m=>decodeNativeBook(channel,m,p=>routes.get(p)));}
connect('crossex_hyperliquid','wss://api.gateio.ws/ws/crossex/public',[{time:Math.floor(Date.now()/1000),channel:'order_book_20',event:'subscribe',payload:['HYPERLIQUID_FUTURE_BTC_USDC','HYPERLIQUID_FUTURE_NVDA_USDC','HYPERLIQUID_FUTURE_CL_USDC']}],m=>m.event==='update'&&m.channel==='order_book_20'?m.result:null);
connect('native_hyperliquid','wss://api.hyperliquid.xyz/ws',['BTC','xyz:NVDA','xyz:CL'].map(coin=>({method:'subscribe',subscription:{type:'l2Book',coin}})),m=>m.channel==='l2Book'?{s:m.data.coin,ts:m.data.time,a:m.data.levels[1]}:null);
const sampler=setInterval(()=>report.samples.push({at:Date.now(),streams:report.connections.flatMap(c=>Object.entries(c.streams).map(([symbol,s])=>({name:c.name,symbol,arrivalAgeMs:Date.now()-s.lastReceived,sourceAgeMs:Date.now()-s.lastSourceAt})))}),1000);timers.push(sampler);
setTimeout(()=>{for(const t of timers)clearInterval(t);loop.disable();report.eventLoop={p99Ms:loop.percentile(99)/1e6,maxMs:loop.max/1e6};for(const ws of sockets)ws.terminate();report.finishedAt=new Date().toISOString();writeFileSync('docs/spread-stream-diagnosis.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,samples:undefined}));},duration);
