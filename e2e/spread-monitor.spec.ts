import { expect, test } from '@playwright/test';
import { DEFAULT_SPREAD_SETTINGS, type SpreadDirection, type SpreadSnapshot } from '../packages/shared-types/src/spread-monitor.js';

const estimate = { quantity: '10', buyVwap: '100', sellVwap: '100.26', buyNotional: '1000', sellNotional: '1002.6', spreadBps: 26, impactBps: 1 };
const funding = { rate: '0.0001', rate8h: '0.0001', hours: 8, nextAt: null };
const row: SpreadDirection = { id: 'GATE_FUTURE_BTC_USDT~BINANCE_FUTURE_BTC_USDT', asset: 'BTC', buySymbol: 'GATE_FUTURE_BTC_USDT', sellSymbol: 'BINANCE_FUTURE_BTC_USDT', buyVenue: 'GATE', sellVenue: 'BINANCE', averageOiUsd: 6000000, marketCapUsd: 100000000, spreadBps: 26, referenceBps: 27, meanBps: 8, deviationBps: 18, coverage: 1, historyHours: 168, elapsedSeconds: 300, status: 'ready', reason: null, estimate, capacity: { amountUsd: '5000', quantity: '50', depthLimited: true }, updatedAt: new Date().toISOString(), buyFunding: funding, sellFunding: funding };

test('价差看板筛选、收藏、成交详情、历史周期和推送记录', async ({ page }) => {
  let snapshot: SpreadSnapshot = { settings: { ...DEFAULT_SPREAD_SETTINGS }, barkConfigured: true, rows: [row], updatedAt: new Date().toISOString(), coverage: { assets: 1, symbols: 2, validSymbols: 2, connections: 1, error: null } };
  let push = () => {};
  await page.routeWebSocket('**/ws/spread-monitor', ws => { push = () => ws.send(JSON.stringify(snapshot)); push(); });
  await page.route('**/api/spread-monitor', route => route.fulfill({ json: snapshot }));
  await page.route('**/api/spread-monitor/settings', async route => { snapshot = { ...snapshot, settings: route.request().postDataJSON() }; await route.fulfill({ json: snapshot }); push(); });
  await page.route('**/api/spread-monitor/detail?*', route => route.fulfill({ json: { row, estimate, capacity: row.capacity } }));
  await page.route('**/api/spread-monitor/history?*', route => route.fulfill({ json: { points: Array.from({ length: 30 }, (_, i) => ({ time: Date.now() - (30 - i) * 60000, value: 8 + i / 2, count: 60 })) } }));
  await page.route('**/api/spread-monitor/notices', route => route.fulfill({ json: { notices: [{ id: 1, directionId: row.id, title: 'BTC 价差条件达标', body: 'Gate 买入 → Binance 卖出', status: 'sent', createdAt: new Date().toISOString() }] } }));
  await page.route('**/api/spread-monitor/test-notification', route => route.fulfill({ json: { status: 'sent' } }));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const modeResponse = page.waitForResponse(response => response.url().endsWith('/api/trading-mode') && response.request().method() === 'GET');
  const response = await page.goto('/spread-monitor'); expect(response?.status()).toBe(200);
  const risk = page.getByRole('dialog', { name: 'Risk disclaimer' });
  if ((await (await modeResponse).json()).mode === 'unset') {
    await expect(risk).toBeVisible(); await risk.getByRole('checkbox').check(); await risk.getByRole('button', { name: /Continue in read-only mode/ }).click(); }
  await expect(page.getByRole('heading', { name: /价差监控/ })).toBeVisible();
  await page.getByRole('button', { name: '发送测试通知', exact: true }).click();
  await expect(page.getByText('Bark 已接收，请检查手机通知。', { exact: true })).toBeVisible();
  await expect(page.locator('.sp-table tbody tr')).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: '历史窗口' })).toHaveValue('7');
  await expect(page.getByRole('columnheader', { name: '参考偏离 BPS' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '历史窗口' }).locator('option')).toHaveCount(4);
  await page.getByRole('combobox', { name: '历史窗口' }).selectOption('30');
  await page.getByRole('button', { name: '应用监控设置' }).click();
  await expect.poll(() => snapshot.settings.historyDays).toBe(30);
  await expect(page.getByRole('button', { name: '应用监控设置' })).toBeEnabled();
  await expect(page.locator('.sp-table tbody')).toContainText('30 天均值');
  snapshot = { ...snapshot, rows: [{ ...row, status: 'warming', historyHours: 48, coverage: 2 / 30, reason: '样本不足，已有样本实时计算' }] }; push();
  await expect(page.locator('.sp-table tbody')).toContainText('样本不足');
  await expect(page.locator('.sp-table tbody')).toContainText('2.00 / 30 天');
  await expect(page.locator('.sp-table tbody')).toContainText('+18.00');
  snapshot = { ...snapshot, rows: [{ ...snapshot.rows[0], spreadBps: 28, deviationBps: 20 }] }; push();
  await expect(page.locator('.sp-table tbody')).toContainText('+20.00');
  await page.getByRole('group', { name: '最低平均持仓量' }).getByRole('button', { name: '$5M', exact: true }).click();
  await page.getByRole('button', { name: '应用监控设置' }).click();
  await expect.poll(() => snapshot.settings.minOiMillions).toBe(5);
  const marketCap = page.getByRole('group', { name: '最低流通市值' });
  await marketCap.getByRole('button', { name: '1 亿美元', exact: true }).click();
  await page.getByRole('button', { name: '应用监控设置' }).click();
  await expect.poll(() => snapshot.settings.minMarketCapMillions).toBe(100);
  await expect(page.locator('.sp-table tbody')).toContainText('流通市值 $100M');
  await expect(page.getByRole('button', { name: '应用监控设置' })).toBeEnabled();
  await marketCap.getByRole('spinbutton').fill('250');
  await page.getByRole('button', { name: '应用监控设置' }).click();
  await expect.poll(() => snapshot.settings.minMarketCapMillions).toBe(250);
  await expect(page.getByRole('button', { name: '应用监控设置' })).toBeEnabled();
  await marketCap.getByRole('button', { name: '不限', exact: true }).click();
  await page.getByRole('button', { name: '应用监控设置' }).click();
  await expect.poll(() => snapshot.settings.minMarketCapMillions).toBe(0);
  await page.getByRole('textbox', { name: '搜索标的' }).fill('ETH');
  await expect(page.locator('.sp-table tbody tr')).toHaveCount(0);
  await page.getByRole('textbox', { name: '搜索标的' }).fill('BTC');
  await page.getByRole('button', { name: '收藏 BTC GATE BINANCE' }).click();
  await expect(page.getByRole('button', { name: '收藏 BTC GATE BINANCE' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '查看 BTC GATE BINANCE 详情' }).click();
  const detail = page.getByRole('dialog', { name: '价差方向详情' });
  await expect(detail).toBeVisible();
  await expect(detail.getByText('参考价差较30 天 K 线均值', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: '当前30 天均值' })).toBeVisible();
  await expect(detail.getByText('当前盘口可足额承接')).toBeVisible();
  await detail.getByRole('button', { name: '1H', exact: true }).click();
  await expect(detail.getByRole('button', { name: '1H', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await detail.getByRole('spinbutton', { name: '目标成交金额' }).fill('2000');
  await expect(detail.getByText('当前盘口可足额承接')).toBeVisible();
  await detail.getByRole('button', { name: '关闭详情' }).click();
  await page.getByRole('switch', { name: '价差推送开关' }).click();
  await expect.poll(() => snapshot.settings.notificationsEnabled).toBe(true);
  await page.getByRole('button', { name: '查看推送记录' }).click();
  const notices = page.getByRole('dialog', { name: '推送记录' });
  await expect(notices.getByText('BTC 价差条件达标')).toBeVisible();
  await notices.getByRole('button', { name: '关闭推送记录' }).click();
  await expect(notices).toHaveCount(0);
  await page.getByRole('textbox', { name: '搜索标的' }).fill('');
  await page.getByRole('button', { name: '实时排序：关', exact: true }).click();
  const eth = { ...row, id: 'eth-direction', asset: 'ETH', deviationBps: 10 };
  snapshot = { ...snapshot, rows: [row, eth] }; push();
  const rows = page.locator('.sp-table tbody tr');
  await expect(rows).toHaveCount(2);
  const geometry = () => page.locator('.sp-table').evaluate(table => ({
    columns: [...table.querySelectorAll('th')].map(cell => cell.getBoundingClientRect().width),
    fitsContainer: table.scrollWidth <= table.parentElement!.clientWidth + 1,
  }));
  const before = await geometry();
  expect(before.fitsContainer).toBe(true);
  snapshot = { ...snapshot, rows: [{ ...row, status: 'stale', reason: 'Binance 盘口超过 5 秒未更新', spreadBps: null, deviationBps: null }, { ...eth, deviationBps: 9999, averageOiUsd: 123456789012 }] }; push();
  await expect(rows).toContainText(['ETH', 'BTC']);
  await expect(rows.last()).toContainText('盘口过期');
  expect(await geometry()).toEqual(before);
  snapshot = { ...snapshot, rows: [{ ...row, status: 'warming', reason: '最新已收盘 K 线尚未返回，正在等待交易所返回完整历史数据' }, eth] }; push();
  await expect(rows.last()).toContainText('样本不足');
  expect(await geometry()).toEqual(before);
  snapshot = { ...snapshot, rows: [row, eth] }; push();
  await expect(rows.first()).toContainText('条件达标');
  expect(await geometry()).toEqual(before);
  await expect(page.getByRole('combobox', { name: '排序' })).toHaveValue('status');
  const sol = { ...row, id: 'sol-direction', asset: 'SOL', status: 'watching' as const, elapsedSeconds: 200, spreadBps: null, deviationBps: null, averageOiUsd: null, capacity: null };
  const btc = { ...row, status: 'watching' as const, elapsedSeconds: 100, spreadBps: -2, deviationBps: 20, averageOiUsd: 100, capacity: { ...row.capacity!, amountUsd: '100' } };
  const ethSort = { ...eth, status: 'ready' as const, elapsedSeconds: 50, spreadBps: 10, deviationBps: 10, averageOiUsd: 20, capacity: { ...row.capacity!, amountUsd: '20' } };
  snapshot = { ...snapshot, rows: [btc, ethSort, sol] }; push();
  await expect(rows).toContainText(['ETH', 'SOL', 'BTC']);
  await expect(page.getByRole('columnheader', { name: '状态 / 累计时间' })).toHaveAttribute('aria-sort', 'descending');
  await page.getByRole('button', { name: '状态 / 累计时间', exact: true }).click();
  await expect(rows).toContainText(['BTC', 'SOL', 'ETH']);
  for (const [label, descending, ascending] of [
    ['市价偏离 BPS', ['ETH', 'BTC', 'SOL'], ['BTC', 'ETH', 'SOL']],
    ['参考偏离 BPS', ['BTC', 'ETH', 'SOL'], ['ETH', 'BTC', 'SOL']],
    ['平均持仓量', ['BTC', 'ETH', 'SOL'], ['ETH', 'BTC', 'SOL']],
    ['估算容量', ['BTC', 'ETH', 'SOL'], ['ETH', 'BTC', 'SOL']],
  ] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(rows).toContainText([...descending]);
    await expect(page.getByRole('columnheader', { name: label })).toHaveAttribute('aria-sort', 'descending');
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(rows).toContainText([...ascending]);
    await expect(page.getByRole('columnheader', { name: label })).toHaveAttribute('aria-sort', 'ascending');
  }
  // 实时更新仍保持用户选择的容量升序，按数值而非字符串重新排序。
  snapshot = { ...snapshot, rows: [btc, { ...ethSort, capacity: { ...row.capacity!, amountUsd: '200' } }, sol] }; push();
  await expect(rows).toContainText(['BTC', 'ETH', 'SOL']);
  await page.getByRole('combobox', { name: '排序' }).selectOption('spread');
  await expect(rows).toContainText(['ETH', 'BTC', 'SOL']);
  await page.getByRole('button', { name: '切换排序方向' }).click();
  await expect(rows).toContainText(['BTC', 'ETH', 'SOL']);
  snapshot = { ...snapshot, rows: [{ ...row, asset: 'CASHCAT', buyVenue: 'HYPERLIQUID', sellVenue: 'OKX', buySymbol: 'HYPERLIQUID_FUTURE_CASHCAT_USDC', sellSymbol: 'OKX_FUTURE_CASHCAT_USDT', buyNativeMarket: 'CASHCAT' }] }; push();
  const hyperliquidLink = page.getByRole('link', { name: '打开 Hyperliquid HYPERLIQUID_FUTURE_CASHCAT_USDC 交易页面' });
  await expect(hyperliquidLink).toHaveAttribute('href', 'https://app.hyperliquid.xyz/trade/CASHCAT');
  await expect(hyperliquidLink).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('link', { name: '打开 OKX OKX_FUTURE_CASHCAT_USDT 交易页面' })).toHaveAttribute('href', 'https://www.okx.com/zh-hans/trade-swap/cashcat-usdt-swap');
  expect(await hyperliquidLink.evaluate(link => !!link.closest('button'))).toBe(false);
  snapshot = { ...snapshot, rows: [{ ...snapshot.rows[0], buyNativeMarket: 'xyz:CASHCAT' }] }; push();
  await expect(hyperliquidLink).toHaveAttribute('href', 'https://app.hyperliquid.xyz/trade/xyz%3ACASHCAT');
  await page.getByRole('textbox', { name: '搜索标的' }).fill('CASHCAT');
  await page.getByRole('combobox', { name: '状态筛选' }).selectOption('ready');
  await page.getByRole('button', { name: '★ 仅关注', exact: true }).click();
  await page.getByRole('combobox', { name: '历史窗口' }).selectOption('3');
  const savedSettings = JSON.stringify(snapshot.settings);
  await page.reload();
  await expect(page.getByRole('textbox', { name: '搜索标的' })).toHaveValue('CASHCAT');
  await expect(page.getByRole('combobox', { name: '状态筛选' })).toHaveValue('ready');
  await expect(page.getByRole('button', { name: '★ 仅关注', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: '排序' })).toHaveValue('spread');
  await expect(page.getByRole('button', { name: '切换排序方向' })).toContainText('升序');
  await expect(page.getByRole('button', { name: '实时排序：开', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '历史窗口' })).toHaveValue('3');
  expect(JSON.stringify(snapshot.settings)).toBe(savedSettings);
  await page.evaluate(() => { localStorage.setItem('spread-view-preferences-v1', '"invalid"'); localStorage.setItem('spread-settings-draft-v1', '{broken'); });
  await page.reload();
  await expect(page.getByRole('textbox', { name: '搜索标的' })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: '排序' })).toHaveValue('status');
  await expect(page.getByRole('combobox', { name: '历史窗口' })).toHaveValue(String(snapshot.settings.historyDays));
  expect(errors).toEqual([]);
});

test('价差 API 校验参数和设置写入意图', async ({ request }) => {
  expect((await request.post('/api/spread-monitor/test-notification')).status()).toBe(403);
  const missing = await request.put('/api/spread-monitor/settings', { data: DEFAULT_SPREAD_SETTINGS });
  expect(missing.status()).toBe(403);
  const invalid = await request.put('/api/spread-monitor/settings', { headers: { 'x-gct-monitor-intent': 'update-settings' }, data: { ...DEFAULT_SPREAD_SETTINGS, venues: ['GATE'] } });
  expect(invalid.status()).toBe(400);
  const invalidWindow = await request.put('/api/spread-monitor/settings', { headers: { 'x-gct-monitor-intent': 'update-settings' }, data: { ...DEFAULT_SPREAD_SETTINGS, historyDays: 2 } });
  expect(invalidWindow.status()).toBe(400);
  expect((await request.get('/api/spread-monitor/detail?id=missing&amount=-1')).status()).toBe(400);
  expect((await request.get('/api/spread-monitor/history?id=missing&amount=1000&minutes=3')).status()).toBe(400);
  const history = await request.get('/api/spread-monitor/history?id=missing&amount=1000&minutes=5');
  expect(await history.json()).toEqual({ points: [] });
  const notices = await request.get('/api/spread-monitor/notices');
  expect(await notices.json()).toEqual({ notices: [] });
});

test('盘口短暂过期时当前页保留方向，实时状态与累计时间仍更新', async ({ page }) => {
  const cl: SpreadDirection = { ...row, id: 'cl-direction', asset: 'CL', status: 'watching', elapsedSeconds: 155 };
  const others: SpreadDirection[] = Array.from({ length: 30 }, (_, i) => ({ ...row, id: `other-${i}`, asset: `OTHER${i}`, status: 'watching', elapsedSeconds: 100 - i }));
  let snapshot: SpreadSnapshot = { settings: { ...DEFAULT_SPREAD_SETTINGS }, barkConfigured: true, rows: [cl, ...others], updatedAt: new Date().toISOString(), coverage: { assets: 31, symbols: 62, validSymbols: 62, connections: 1, error: null } };
  let push = () => {};
  await page.routeWebSocket('**/ws/spread-monitor', ws => { push = () => ws.send(JSON.stringify(snapshot)); push(); });
  await page.route('**/api/spread-monitor', route => route.fulfill({ json: snapshot }));
  const modeResponse = page.waitForResponse(response => response.url().endsWith('/api/trading-mode') && response.request().method() === 'GET');
  await page.goto('/spread-monitor');
  if ((await (await modeResponse).json()).mode === 'unset') {
    const risk = page.getByRole('dialog', { name: 'Risk disclaimer' });
    await risk.getByRole('checkbox').check(); await risk.getByRole('button', { name: /Continue in read-only mode/ }).click();
  }
  const clRow = page.locator('.sp-table tbody tr').filter({ has: page.getByRole('button', { name: '收藏 CL GATE BINANCE' }) });
  await expect(clRow).toContainText('155 / 300 秒');
  snapshot = { ...snapshot, updatedAt: new Date(Date.parse(cl.updatedAt!) + 3000).toISOString(), rows: [{ ...cl, status: 'stale', staleCause: 'out_of_sync', reason: '双边盘口时间差超过 2 秒', spreadBps: null, capacity: null, lastValid: { spreadBps: cl.spreadBps!, referenceBps: cl.referenceBps!, meanBps: cl.meanBps, deviationBps: cl.deviationBps, coverage: cl.coverage, capacity: cl.capacity, updatedAt: cl.updatedAt! } }, ...others] }; push();
  await expect(clRow).toContainText('双边不同步', { timeout: 2000 });
  await expect(clRow).toContainText('+26.00');
  await expect(clRow).toContainText('$5,000');
  await expect(clRow).toContainText('上次有效 · 3 秒前');
  await expect(clRow).toHaveClass('sp-cached-row');
  await expect(clRow).toContainText('155 / 300 秒');
  snapshot = { ...snapshot, rows: [{ ...cl, elapsedSeconds: 156 }, ...others] }; push();
  await expect(clRow).toContainText('156 / 300 秒');
  await expect(clRow).not.toHaveClass('sp-cached-row');
  await expect(clRow).not.toContainText('上次有效');
  snapshot = { ...snapshot, updatedAt: new Date(Date.parse(cl.updatedAt!) + 3000).toISOString(), rows: [{ ...cl, status: 'stale', staleCause: 'out_of_sync', reason: '双边盘口时间差超过 2 秒', spreadBps: null, capacity: null, lastValid: { spreadBps: cl.spreadBps!, referenceBps: cl.referenceBps!, meanBps: cl.meanBps, deviationBps: cl.deviationBps, coverage: cl.coverage, capacity: cl.capacity, updatedAt: cl.updatedAt! } }, ...others] }; push();
  await expect(clRow).toContainText('（暂停）');
  await page.getByRole('button', { name: '更新排序', exact: true }).click();
  await expect(clRow).toHaveCount(0);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(clRow).toContainText('双边不同步');
  // 手动排序仍按最新数据生效；实时排序为显式选择。
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.getByRole('button', { name: '实时排序：关', exact: true }).click();
  snapshot = { ...snapshot, rows: [{ ...cl, elapsedSeconds: 157 }, ...others] }; push();
  await expect(clRow).toContainText('157 / 300 秒');
});
