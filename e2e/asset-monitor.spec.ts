import { expect, test } from '@playwright/test';
import { DEFAULT_OBSERVATION_SETTINGS, type ObservationMarket, type ObservationSnapshot } from '../packages/shared-types/src/asset-monitor.js';

function fixture():ObservationSnapshot {
 const now=Date.now();
 const market=(id:string,venue:ObservationMarket['venue'],base:string,product:ObservationMarket['product'],bid:string):ObservationMarket=>({id,venue,nativeSymbol:`${base}-USDT`,base,quote:'USDT',product,category:'gold',bid,ask:String(Number(bid)+1),bidSize:'10',askSize:'10',observedAt:now,sourceAt:now,error:null});
 const markets=[market('a','GATE','PAXG','perpetual','3990'),market('b','GATE','XAUT','perpetual','4000'),market('c','BINANCE','PAXG','perpetual','3995'),market('d','BINANCE','XAU','perpetual','4005')];
 return {updatedAt:now,pollingMs:10000,staleMs:30000,settings:{...DEFAULT_OBSERVATION_SETTINGS},barkConfigured:false,stable:[{id:'s',marketId:'sm',venue:'GATE',nativeSymbol:'USDE_USDT',buy:'USDE',pay:'USDT',inverse:false,price:'0.985',payAmount:'500',marketStats:{marketCapUsd:120000000,volume24hUsd:2500000,updatedAt:now},depthTo0998:{payAmount:'1234.56',buyAmount:'1240',levels:20,complete:false},status:'discount',durationSeconds:20,observedAt:now},{id:'sr',marketId:'sm',venue:'GATE',nativeSymbol:'USDE_USDT',buy:'USDT',pay:'USDE',inverse:true,price:'1.02',payAmount:'400',status:'normal',durationSeconds:0,observedAt:now}],gold:markets.map(m=>({market:m,bid:m.bid,ask:m.ask,normalizedAt:now,conversion:'原始USDT',ready:true})),sources:[{venue:'GATE',product:'spot',count:3,checkedAt:now,error:null}],registry:['USDT','USDC','USDE'],events:[]};
}
test('策略入口、稳定币列表及黄金同所选择、独立历史基准和真实历史空态',async({page})=>{
 let snapshot=fixture();const historyRequests:string[]=[];page.on('request',r=>{if(r.url().includes('/api/asset-monitor/history?'))historyRequests.push(r.url());});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/asset-monitor',route=>{snapshot={...snapshot,updatedAt:Date.now(),stable:snapshot.stable.map(r=>({...r,observedAt:Date.now()})),gold:snapshot.gold.map(g=>({...g,normalizedAt:Date.now(),market:{...g.market,observedAt:Date.now()}}))};return route.fulfill({json:snapshot});});
 await page.route('**/api/asset-monitor/settings',route=>{snapshot={...snapshot,settings:route.request().postDataJSON()};return route.fulfill({json:snapshot});});
 await page.route('**/api/asset-monitor/history?*',route=>route.fulfill({json:{source:'exchange_candles',loadedAt:Date.now(),quote:'USDT',referenceIntervalMs:3600000,warning:null,points:[],sampleCount:0,intervalMs:60000,startedAt:null,reference:{hours:Number(new URL(route.request().url()).searchParams.get('referenceHours')),meanPct:null,sampleCount:0,expectedSamples:168,coverage:0,latestAt:null,fresh:false,sufficient:false}}}));
 const mode=page.waitForResponse(r=>r.url().endsWith('/api/trading-mode')&&r.request().method()==='GET');
 const response=await page.goto('/strategies/asset-monitor');expect(response?.status()).toBe(200);
 if((await(await mode).json()).mode==='unset'){const risk=page.getByRole('dialog',{name:'Risk disclaimer'});await risk.getByRole('checkbox').check();await risk.getByRole('button',{name:/Continue in read-only mode/}).click();}
 await expect(page.getByRole('heading',{name:'稳定币与黄金监控'})).toBeVisible();await expect(page.locator('.asset-observer tbody tr')).toHaveCount(1);await expect(page.getByRole('columnheader',{name:'市值 / 24h成交额'})).toBeVisible();await expect(page.locator('.asset-observer tbody')).toContainText('市值 1.2亿 USD');await expect(page.locator('.asset-observer tbody')).toContainText('24h 250万 USD');await expect(page.getByRole('columnheader',{name:'买到 0.998 的深度'})).toBeVisible();await expect(page.locator('.asset-observer tbody')).toContainText('≥ 1,234.56');
 await page.getByLabel('支付币范围').selectOption('all');await expect(page.locator('.asset-observer tbody tr')).toHaveCount(2);
 await page.getByRole('button',{name:'详情',exact:true}).first().click();await expect(page.locator('.ao-dialog')).toContainText('0.985');await page.getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'提醒设置'}).click();await page.getByLabel('买入价低于').fill('0.98');await page.getByRole('button',{name:'保存设置'}).click();await expect.poll(()=>snapshot.settings.threshold).toBe('0.98');
 await page.getByRole('button',{name:'黄金价差观察'}).click();await expect(page.locator('.ao-leg select[data-market]').nth(0)).toHaveValue('c');snapshot={...snapshot,gold:[...snapshot.gold].reverse()};await page.waitForResponse(r=>r.url().endsWith('/api/asset-monitor'));await expect(page.locator('.ao-leg select[data-market]').nth(0)).toHaveValue('c');await page.locator('.ao-leg select[data-market]').nth(1).selectOption('b');await page.locator('.ao-leg select[data-market]').nth(0).selectOption('a');await expect(page.getByLabel('历史均值窗口')).toHaveValue('168');await expect(page.getByText('当前方向价差',{exact:true})).toBeVisible();await expect(page.locator('.ao-leg select[data-market]').nth(0)).toHaveValue('a');await expect(page.locator('.ao-leg select[data-market]').nth(1)).toHaveValue('b');
 await expect(page.getByLabel('卖出市场')).toHaveValue('a');await expect(page.getByLabel('买入市场')).toHaveValue('b');await expect(page.locator('.ao-gap')).toContainText('-27.49 bps');await page.getByRole('button',{name:'切换方向',exact:true}).click();await expect(page.locator('.ao-gap')).toContainText('-22.50 bps');await expect(page.getByLabel('买入市场')).toHaveValue('a');await expect(page.getByLabel('卖出市场')).toHaveValue('b');await page.getByRole('button',{name:'切换方向',exact:true}).click();
 await expect(page.locator('.ao-leg').first().getByRole('link',{name:'打开 Gate PAXG-USDT 永续市场'})).toHaveAttribute('href','https://www.gate.com/zh/futures/USDT/PAXG_USDT');
 await expect(page.locator('.ao-leg').nth(1).getByRole('link',{name:'打开 Gate XAUT-USDT 永续市场'})).toHaveAttribute('target','_blank');
 await expect(page.getByText(/尚无同步历史/)).toBeVisible();await expect(page.getByText('买卖方向毛价差',{exact:true})).toBeVisible();
 await expect(page.locator('.ao-leg select[data-market]').nth(0).locator('option')).toHaveCount(3);
 await page.locator('.ao-leg select[data-market]').nth(0).selectOption('c');await page.locator('.ao-leg select[data-market]').nth(1).selectOption('d');await expect(page.locator('.ao-leg select[data-market]').nth(0)).toHaveValue('c');await expect(page.locator('.ao-leg select[data-market]').nth(1)).toHaveValue('d');await expect(page.locator('.ao-leg select[data-market]').nth(0).locator('option')).toHaveCount(3);
 await page.getByRole('button',{name:'切换方向',exact:true}).click();await expect(page.getByLabel('买入市场')).toHaveValue('c');await expect(page.getByLabel('卖出市场')).toHaveValue('d');
 await page.locator('.ao-leg select[data-market]').nth(1).selectOption('b');await page.locator('.ao-leg select[data-market]').nth(0).selectOption('a');
 await page.route('**/api/asset-monitor/history?*',route=>route.fulfill({json:{source:'exchange_candles',loadedAt:Date.now(),quote:'USDT',referenceIntervalMs:3600000,warning:null,points:Array.from({length:25},(_,i)=>({time:Date.now()-(25-i)*60000-(i<3?600000:0),value:-.5+i*.01,leftClose:3990,rightClose:4000})),sampleCount:25,intervalMs:60000,startedAt:Date.now()-1500000,reference:{hours:Number(new URL(route.request().url()).searchParams.get('referenceHours')),meanPct:-.5,sampleCount:25,expectedSamples:168,coverage:25/168,latestAt:Date.now()-60000,fresh:true,sufficient:false}}}));
 await expect(page.getByRole('group',{name:'黄金图表采样周期'}).getByRole('button')).toHaveText(['1m','5m','15m','1H','4H','1D','1W']);
 const minuteRequest=page.waitForRequest(r=>r.url().includes('/api/asset-monitor/history?')&&new URL(r.url()).searchParams.get('intervalMinutes')==='1');
 await page.getByRole('button',{name:'1m',exact:true}).click();await minuteRequest;await expect(page.getByLabel('历史均值窗口')).toHaveValue('168');await expect(page.locator('.ao-gap strong')).toHaveText('-22.50 bps');await expect(page.locator('.ao-gap')).toContainText('样本不足');await expect(page.getByRole('img',{name:/黄金真实历史溢折价.*25 points/})).toBeVisible();await expect(page.locator('.premium-history-chart canvas').first()).toBeVisible();await expect(page.locator('.ao-history-reading strong')).toHaveText('-22.50 bps');const ma20=page.getByRole('button',{name:/MA\(20\)/});await expect(ma20).toHaveAttribute('aria-pressed','true');await ma20.click();await expect(ma20).toHaveAttribute('aria-pressed','false');await page.getByRole('button',{name:'回到最新',exact:true}).click();
 const count=historyRequests.length;await page.clock.install();await page.clock.fastForward(16000);expect(historyRequests).toHaveLength(count);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/asset-monitor-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'test-results/asset-monitor-desktop.png',fullPage:true});expect(errors).toEqual([]);
});

test('全市场价差保留观察，只有可用支付币且足额的方向标红',async({page})=>{
 let snapshot=fixture();const now=Date.now();
 snapshot={...snapshot,stable:[
  ...snapshot.stable.filter(r=>r.id==='s'),
  {id:'crv',marketId:'crv-market',venue:'GATE',nativeSymbol:'CRVUSD_USDT',buy:'USDT',pay:'CRVUSD',inverse:true,price:'0.981547',payAmount:'0.9',status:'discount',durationSeconds:0,observedAt:now},
  {id:'thin',marketId:'thin-market',venue:'GATE',nativeSymbol:'USDD_USDT',buy:'USDD',pay:'USDT',inverse:false,price:'0.985',payAmount:'0.9',status:'discount',durationSeconds:0,observedAt:now},
 ]};
 await page.route('**/api/asset-monitor',route=>route.fulfill({json:{...snapshot,stable:snapshot.stable.map(r=>({...r,observedAt:Date.now()}))}}));
 await page.route('**/api/asset-monitor/settings',route=>{snapshot={...snapshot,settings:route.request().postDataJSON()};return route.fulfill({json:snapshot});});
 const mode=page.waitForResponse(r=>r.url().endsWith('/api/trading-mode')&&r.request().method()==='GET');await page.goto('/strategies/asset-monitor');
 if((await(await mode).json()).mode==='unset'){const risk=page.getByRole('dialog',{name:'Risk disclaimer'});await risk.getByRole('checkbox').check();await risk.getByRole('button',{name:/Continue in read-only mode/}).click();}
 const rows=page.locator('.asset-observer tbody tr');
 await expect(rows).toHaveCount(2);
 await expect(rows.filter({hasText:'USDE / USDT'})).toHaveClass(/ao-discount-row/);
 await expect(rows.filter({hasText:'USDD / USDT'})).not.toHaveClass(/ao-discount-row/);
 await expect(rows.filter({hasText:'USDD / USDT'})).toContainText('仅观察 · 金额不足');
 await page.getByLabel('支付币范围').selectOption('all');
 await expect(rows).toHaveCount(3);
 await expect(rows.filter({hasText:'USDT / CRVUSD'})).not.toHaveClass(/ao-discount-row/);
 await expect(rows.filter({hasText:'USDT / CRVUSD'})).toContainText('仅观察 · 无可用支付币');
 await page.getByRole('button',{name:'提醒设置'}).click();
 await expect(page.getByLabel('可用支付币（参与提醒）').locator('option')).toHaveCount(3);
 await page.getByLabel('第一档最低可买金额').fill('0');
 await page.getByRole('button',{name:'保存设置'}).click();
 await expect(rows.filter({hasText:'USDD / USDT'})).toHaveClass(/ao-discount-row/);
 await expect(rows.filter({hasText:'USDT / CRVUSD'})).not.toHaveClass(/ao-discount-row/);
});

test('黄金左拖分页只补旧数据，不重置已选市场或历史均值',async({page})=>{
 const snapshot=fixture(),step=300000,end=Math.floor(Date.now()/step)*step;const requests:URL[]=[];
 await page.route('**/api/asset-monitor',route=>route.fulfill({json:snapshot}));
 await page.route('**/api/asset-monitor/history?*',route=>{
  const url=new URL(route.request().url());if(url.searchParams.get('intervalMinutes')==='5')requests.push(url);const before=Number(url.searchParams.get('before')??end),older=url.searchParams.has('before');
  return route.fulfill({json:{source:'exchange_candles',loadedAt:end,quote:'USDT',referenceIntervalMs:3600000,warning:null,points:Array.from({length:300},(_,i)=>({time:before-(300-i)*step,value:-.05+i*.0001,leftClose:4000,rightClose:4002})),sampleCount:300,intervalMs:step,startedAt:before-300*step,nextBefore:before-300*step,hasMore:!older,reference:{minPct:-.2,maxPct:.1,hours:168,meanPct:older?99:-.05,sampleCount:168,expectedSamples:168,coverage:1,latestAt:end-3600000,fresh:true,sufficient:true}}});
 });
 const mode=page.waitForResponse(r=>r.url().endsWith('/api/trading-mode')&&r.request().method()==='GET');await page.goto('/strategies/asset-monitor');
 if((await(await mode).json()).mode==='unset'){const risk=page.getByRole('dialog',{name:'Risk disclaimer'});await risk.getByRole('checkbox').check();await risk.getByRole('button',{name:/Continue in read-only mode/}).click();}
 await page.getByRole('button',{name:'黄金价差观察'}).click();
 const chart=page.getByRole('img',{name:/黄金真实历史溢折价/});await expect(chart).toHaveAttribute('aria-label',/300 points/);await chart.scrollIntoViewIfNeeded();
 expect(requests[0].searchParams.get('hours')).toBe('25');expect(requests[0].searchParams.get('a')).toBe('c');expect(requests[0].searchParams.get('b')).toBe('a');
 const box=(await chart.boundingBox())!;
 for(let i=0;i<4&&requests.length<2;i++){await page.mouse.move(box.x+80,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width-80,box.y+box.height/2,{steps:20});await page.mouse.up();}
 await expect(chart).toHaveAttribute('aria-label',/600 points/);expect(requests).toHaveLength(2);expect(Number(requests[1].searchParams.get('before'))).toBe(end-300*step);
 await expect(page.locator('.ao-gap')).toContainText('7天均值 -5.00 bps');await expect(page.getByText('已到当前可获取历史的边界',{exact:true})).toBeVisible();
 await expect(page.locator('.ao-leg select[data-market]').nth(0)).toHaveValue('c');
 const overview=page.locator('aside .ao-panel').first();await expect(overview).toContainText('-20.00 bps');await expect(overview).toContainText('+10.00 bps');const beforeStats=(await overview.textContent())!;
 await page.getByRole('button',{name:'1m',exact:true}).click();await expect(chart).toHaveAttribute('aria-label',/300 points/);await expect(overview).toHaveText(beforeStats);
});

test('跨所黄金组合跟随均值窗口、排序并一键选择双腿',async({page})=>{
 let snapshot=fixture();
 await page.route('**/api/asset-monitor',route=>route.fulfill({json:snapshot}));
 await page.route('**/api/asset-monitor/history?*',route=>{
  const params=new URL(route.request().url()).searchParams;
  const key=`${params.get('a')}:${params.get('b')}`;
  const referenceHours=Number(params.get('referenceHours'));
  const mean=(referenceHours===720?1:0)+(({'a:c':-.4,'a:d':-.2,'b:c':.1,'b:d':.3} as Record<string,number>)[key]??0);
  return route.fulfill({json:{source:'exchange_candles',loadedAt:Date.now(),quote:'USDT',referenceIntervalMs:3600000,warning:null,points:[],sampleCount:0,intervalMs:3600000,startedAt:null,reference:{hours:referenceHours,meanPct:mean,minPct:mean-.1,maxPct:mean+(key==='b:d'?.4:.1),sampleCount:referenceHours,expectedSamples:referenceHours,coverage:1,latestAt:Date.now()-3600000,fresh:true,sufficient:true}}});
 });
 const mode=page.waitForResponse(r=>r.url().endsWith('/api/trading-mode')&&r.request().method()==='GET');await page.goto('/strategies/asset-monitor');
 if((await(await mode).json()).mode==='unset'){const risk=page.getByRole('dialog',{name:'Risk disclaimer'});await risk.getByRole('checkbox').check();await risk.getByRole('button',{name:/Continue in read-only mode/}).click();}
 await page.getByRole('button',{name:'黄金价差观察'}).click();
 const table=page.locator('.ao-pair-table');await expect(table.locator('tbody tr')).toHaveCount(4);
 await expect(page.getByText('4/4 组已加载')).toBeVisible();
 await expect(table.getByRole('columnheader',{name:'最高－最低'})).toBeVisible();
 await expect(table.locator('tbody tr').first().locator('td').nth(6)).toHaveText('20.00 bps');
 await expect(table.locator('tbody tr').filter({hasText:'Gate · PAXG'}).first()).toContainText('100.0%');
 await page.getByRole('button',{name:'按7天历史均值升序排序'}).click();
 await expect(table.locator('tbody tr').first()).toContainText('-40.00 bps');
 await page.getByRole('button',{name:'按7天历史均值降序排序'}).click();
 await expect(table.locator('tbody tr').first()).toContainText('+30.00 bps');
 await page.getByRole('button',{name:'按最高－最低升序排序'}).click();
 await expect(table.locator('tbody tr').first().locator('td').nth(6)).toHaveText('20.00 bps');
 await page.getByRole('button',{name:'按最高－最低降序排序'}).click();
 await expect(table.locator('tbody tr').first()).toContainText('50.00 bps');
 await expect(table.locator('tbody tr').first()).toContainText('Gate · XAUT');
 await expect(table.getByRole('columnheader',{name:/当前价差/})).toBeVisible();
 await expect(table.locator('thead th').nth(1)).toContainText('7天历史均值');
 await expect(table.locator('thead th').nth(2)).toContainText('当前价差');
 await expect(table.locator('thead th').nth(3)).toContainText('当前较均值');
 await expect(table.locator('thead th').nth(4)).toContainText('7天最低');
 await expect(table.locator('thead th').nth(7)).toContainText('基准状态');
 await page.getByRole('button',{name:'按当前价差升序排序'}).click();
 await expect(table.locator('tbody tr').first()).toContainText('Gate · PAXG');
 await expect(table.locator('tbody tr').first()).toContainText('Binance · XAU');
 await page.getByRole('button',{name:'按当前价差降序排序'}).click();
 await expect(table.locator('tbody tr').first()).toContainText('Gate · XAUT');
 await expect(table.locator('tbody tr').first()).toContainText('Binance · PAXG');
 const pairRow=table.locator('tbody tr').filter({hasText:'Gate · XAUT'}).filter({hasText:'Binance · XAU'});
 await expect(pairRow.locator('td').nth(2)).toHaveText('-14.98 bps');
 await expect(pairRow.getByRole('link',{name:'打开 Gate XAUT-USDT 永续市场'})).toHaveAttribute('href','https://www.gate.com/zh/futures/USDT/XAUT_USDT');
 await expect(pairRow.getByRole('link',{name:'打开 Binance XAU-USDT 永续市场'})).toHaveAttribute('href','https://www.binance.com/zh-CN/futures/XAUUSDT');
 await expect(pairRow.getByRole('link',{name:'打开 Binance XAU-USDT 永续市场'})).toHaveAttribute('rel','noopener noreferrer');
 await table.getByRole('button',{name:'观察 Gate XAUT 和 Binance XAU'}).click();
 await expect(page.locator('.ao-leg select[data-market]').nth(0)).toHaveValue('b');
 await expect(page.locator('.ao-leg select[data-market]').nth(1)).toHaveValue('d');
 await expect(table.locator('.ao-pair-selected')).toHaveCount(1);
 await page.getByLabel('历史均值窗口').selectOption('720');
 await expect(table.locator('thead th').nth(1)).toContainText('30天历史均值');
 await expect(table.locator('thead th').nth(4)).toContainText('30天最低');
 await expect(pairRow.locator('td').nth(1)).toHaveText('+130.00 bps');
 await expect(pairRow.locator('td').nth(3)).toHaveText('-144.98 bps');
 await expect(pairRow).toContainText('720 / 720');
 await page.getByLabel('历史均值窗口').selectOption('168');
 await expect(table.locator('thead th').nth(1)).toContainText('7天历史均值');
 await expect(pairRow.locator('td').nth(1)).toHaveText('+30.00 bps');
 await expect(pairRow).toContainText('168 / 168');
 snapshot={...snapshot,gold:snapshot.gold.map(g=>({...g,normalizedAt:Date.now(),bid:g.market.id==='b'?'4010':g.bid,ask:g.market.id==='b'?'4011':g.ask}))};
 await page.waitForResponse(r=>r.url().endsWith('/api/asset-monitor'));
 await expect(pairRow.locator('td').nth(2)).toHaveText('+9.99 bps');
 snapshot={...snapshot,gold:snapshot.gold.map(g=>g.market.id==='b'?{...g,normalizedAt:Date.now()-31000}:g)};
 await page.waitForResponse(r=>r.url().endsWith('/api/asset-monitor'));
 await expect(pairRow.locator('td').nth(2)).toHaveText('—');
});

test('黄金提醒设置校验阈值、保存并在重新打开及刷新后保留',async({page})=>{
 let snapshot={...fixture(),barkConfigured:true,goldSettings:{thresholdBps:35,durationSeconds:20,recoveryBps:30,recoverySeconds:20,notificationsEnabled:true}};
 await page.route('**/api/asset-monitor',route=>route.fulfill({json:snapshot}));
 await page.route('**/api/asset-monitor/gold-settings',route=>{
  expect(route.request().headers()['x-gct-monitor-intent']).toBe('update-settings');
  snapshot={...snapshot,goldSettings:route.request().postDataJSON()};return route.fulfill({json:snapshot});
 });
 await page.route('**/api/asset-monitor/history?*',route=>route.fulfill({status:503,json:{error:'unavailable'}}));
 const mode=page.waitForResponse(r=>r.url().endsWith('/api/trading-mode')&&r.request().method()==='GET');await page.goto('/strategies/asset-monitor');
 if((await(await mode).json()).mode==='unset'){const risk=page.getByRole('dialog',{name:'Risk disclaimer'});await risk.getByRole('checkbox').check();await risk.getByRole('button',{name:/Continue in read-only mode/}).click();}
 await page.getByRole('button',{name:'黄金价差观察'}).click();await page.getByRole('button',{name:'提醒设置',exact:true}).click();
 const dialog=page.locator('dialog').filter({hasText:'黄金提醒设置'});
 await expect(dialog.getByLabel('可成交毛价差大于（bps）')).toHaveValue('35');
 await dialog.getByLabel('恢复价差低于（bps）').fill('40');await dialog.getByRole('button',{name:'保存设置'}).click();
 await expect(dialog.getByRole('alert')).toContainText('恢复阈值必须小于触发阈值');
 await dialog.getByLabel('可成交毛价差大于（bps）').fill('50');await dialog.getByLabel('触发持续时间（秒）').fill('15');
 await dialog.getByLabel('恢复价差低于（bps）').fill('25');await dialog.getByLabel('恢复持续时间（秒）').fill('10');await dialog.getByLabel('Bark 手机提醒').uncheck();
 await dialog.getByRole('button',{name:'保存设置'}).click();await expect(dialog).not.toBeVisible();
 await expect(page.getByText(/黄金告警：/)).toContainText('50 bps');await expect(page.getByText(/黄金告警：/)).toContainText('Bark 手机提醒已关闭');
 await page.reload();await page.getByRole('button',{name:'黄金价差观察'}).click();await page.getByRole('button',{name:'提醒设置',exact:true}).click();
 await expect(dialog.getByLabel('可成交毛价差大于（bps）')).toHaveValue('50');await expect(dialog.getByLabel('恢复持续时间（秒）')).toHaveValue('10');await expect(dialog.getByLabel('Bark 手机提醒')).not.toBeChecked();
});
