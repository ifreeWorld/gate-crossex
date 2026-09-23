import { z } from 'zod';
import { useEffect, useRef, useState } from 'react';
import { SpreadSettingsSchema, SpreadSnapshotSchema, SPREAD_VENUES, SPREAD_HISTORY_DAYS, spreadHistoryLabel, type SpreadDirection, type SpreadNotice, type SpreadSettings, type SpreadSnapshot } from '@gate-crossex/shared-types';
import { api, ApiError } from './api.js';
import { SpreadMonitorChart } from './spread-monitor-chart.js';
import './spread-monitor.css';
import { spreadTradeLink } from './spread-trade-link.js';

const labels: Record<SpreadDirection['status'], string> = { ready: '条件达标', watching: '观察中', below: '未达标', warming: '样本不足', stale: '行情待同步', insufficient_depth: '深度不足' };
const statusLabel = (row: SpreadDirection) => row.status !== 'stale' ? labels[row.status] : row.staleCause === 'out_of_sync' ? '双边不同步' : row.staleCause === 'unavailable' ? '行情不可用' : '盘口过期';
const sortColumns = { status: '状态 / 累计时间', spread: '市价偏离 BPS', deviation: '参考偏离 BPS', oi: '平均持仓量', capacity: '估算容量' } as const;
type SortColumn = keyof typeof sortColumns;
const statusPriority: Record<SpreadDirection['status'], number> = { ready: 6, watching: 5, below: 4, insufficient_depth: 3, warming: 2, stale: 1 };
const signed = (value: number | null) => value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
const marketDeviation = (row: { spreadBps: number | null; meanBps: number | null }) => row.spreadBps === null || row.meanBps === null ? null : row.spreadBps - row.meanBps;
const money = (value: number | string | null | undefined) => value == null ? '—' : `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const compactMoney = (value: number | null | undefined) => {
  if (value == null) return '—';
  const scale = Math.abs(value) >= 1e9 ? 1e9 : Math.abs(value) >= 1e6 ? 1e6 : 1;
  return `${money(value / scale)}${scale === 1e9 ? 'B' : scale === 1e6 ? 'M' : ''}`;
};
const rate = (value: string | null) => value === null ? '—' : `${(Number(value) * 100).toFixed(4)}%`;
const venueName = (venue: string) => ({ GATE: 'Gate', BINANCE: 'Binance', OKX: 'OKX', BYBIT: 'Bybit', KRAKEN: 'Kraken', HYPERLIQUID: 'Hyperliquid' }[venue] ?? venue);
const errorText = (error: unknown) => error instanceof ApiError && error.message.includes('bark_not_configured') ? '请先在本地配置 BARK_DEVICE_KEY 并重启后端。' : '请求失败，请检查后端连接后重试。';

const viewPreferencesSchema = z.object({
  query: z.string().catch(''), status: z.enum(['all', 'ready', 'watching', 'below', 'warming', 'stale', 'insufficient_depth']).catch('all'),
  sort: z.enum(['status', 'spread', 'deviation', 'oi', 'capacity']).catch('status'),
  sortDirection: z.enum(['asc', 'desc']).catch('desc'), realtimeSort: z.boolean().catch(false), onlyFavorites: z.boolean().catch(false),
});
function readLocal(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
}
function writeLocal(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 存储不可用时仍可正常筛选。 */ }
}
const viewPreferencesKey = 'spread-view-preferences-v1';
const settingsDraftKey = 'spread-settings-draft-v1';
function restoreDraft(settings: SpreadSettings) {
  const saved = z.object({ base: SpreadSettingsSchema, draft: SpreadSettingsSchema }).safeParse(readLocal(settingsDraftKey));
  // 后台条件在其它页面修改时，以后台为准；通知开关始终取当前值。
  const signature = (value: SpreadSettings) => JSON.stringify({ ...value, notificationsEnabled: false });
  return saved.success && signature(saved.data.base) === signature(settings)
    ? { ...saved.data.draft, notificationsEnabled: settings.notificationsEnabled } : settings;
}

function VenueLink({ venue, symbol, nativeMarket }: { venue: string; symbol: string; nativeMarket?: string }) {
  const href = spreadTradeLink(symbol, nativeMarket);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`打开 ${venueName(venue)} ${symbol} 交易页面`} title={`在新标签页打开 ${venueName(venue)} 交易页面`}>{venueName(venue)}</a> : <span>{venueName(venue)}</span>;
}

function useSpreadSnapshot() {
  const [snapshot, setSnapshot] = useState<SpreadSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/spread-monitor`);
      socket.onmessage = event => {
        try {
          const parsed = SpreadSnapshotSchema.safeParse(JSON.parse(String(event.data)));
          if (!parsed.success || stopped) return;
          setSnapshot(parsed.data); setConnected(true); setError('');
          clearTimeout(watchdog); watchdog = setTimeout(() => { setConnected(false); socket?.close(); }, 10000);
        } catch { setError('行情响应格式异常'); }
      };
      socket.onclose = () => { if (!stopped) { setConnected(false); retry = setTimeout(connect, 2500); } };
      socket.onerror = () => { if (!stopped) setError('监控连接中断，正在重连'); };
    };
    connect();
    void api.spreadSnapshot().then(data => { if (!stopped) setSnapshot(current => current ?? data); }).catch(error => { if (!stopped) setError(errorText(error)); });
    return () => { stopped = true; clearTimeout(retry); clearTimeout(watchdog); socket?.close(); };
  }, []);
  return { snapshot, setSnapshot, connected, error };
}

export function SpreadMonitorView() {
  const { snapshot, setSnapshot, connected, error } = useSpreadSnapshot();
  const [preferences] = useState(() => viewPreferencesSchema.catch(viewPreferencesSchema.parse({})).parse(readLocal(viewPreferencesKey)));
  const [query, setQuery] = useState(preferences.query);
  const [status, setStatus] = useState<string>(preferences.status);
  const [sort, setSort] = useState<SortColumn>(preferences.sort);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(preferences.sortDirection);
  const [realtimeSort, setRealtimeSort] = useState(preferences.realtimeSort);
  const [sortBasis, setSortBasis] = useState<SpreadDirection[]>([]);
  // 仅冻结排序依据，单元格始终读取最新快照；新增方向补入依据。
  useEffect(() => {
    if (realtimeSort || !snapshot?.rows.length) return;
    setSortBasis(current => {
      const known = new Set(current.map(row => row.id));
      const added = snapshot.rows.filter(row => !known.has(row.id));
      return added.length ? [...current, ...added] : current;
    });
  }, [snapshot, realtimeSort]);
  const [favorites, setFavorites] = useState<string[]>(() => { try { const parsed: unknown = JSON.parse(localStorage.getItem('spread-favorites') ?? '[]'); return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []; } catch { return []; } });
  const [onlyFavorites, setOnlyFavorites] = useState(preferences.onlyFavorites);
  useEffect(() => { writeLocal(viewPreferencesKey, { query, status, sort, sortDirection, realtimeSort, onlyFavorites }); }, [query, status, sort, sortDirection, realtimeSort, onlyFavorites]);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [showNotices, setShowNotices] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [pushFeedback, setPushFeedback] = useState('');
  async function testPush() {
    setTestingPush(true); setPushFeedback('');
    try { const { status } = await api.spreadTestNotification(); setPushFeedback(status === 'sent' ? 'Bark 已接收，请检查手机通知。' : status === 'failed' ? '发送失败，请检查 Bark 配置和推送记录。' : '发送结果未知，请先检查手机，避免重复发送。'); }
    catch (error) { setPushFeedback(errorText(error)); }
    finally { setTestingPush(false); }
  }
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  async function save(settings: SpreadSettings) {
    setSaving(true); setSaveError('');
    try { const data = await api.spreadSettings(settings); writeLocal(settingsDraftKey, { base: data.settings, draft: data.settings }); setSnapshot(data); setSortBasis([]); setPage(1); }
    catch (error) { setSaveError(errorText(error)); throw error; }
    finally { setSaving(false); }
  }
  function star(id: string) { const next = favorites.includes(id) ? favorites.filter(x => x !== id) : [...favorites, id]; setFavorites(next); writeLocal('spread-favorites', next); }
  function changeSort(column: SortColumn) {
    setSortDirection(column === sort && sortDirection === 'desc' ? 'asc' : 'desc');
    setSort(column); setSortBasis(snapshot?.rows ?? []); setPage(1);
  }
  function sortHeader(column: SortColumn) {
    return <th key={column} aria-sort={sort === column ? sortDirection === 'desc' ? 'descending' : 'ascending' : 'none'}><button type="button" className="sp-sort-column" onClick={() => changeSort(column)} title={`点击按${sortColumns[column]}${sort === column && sortDirection === 'desc' ? '升序' : '降序'}排列`}>{sortColumns[column]}<span aria-hidden="true">{sort === column ? sortDirection === 'desc' ? '↓' : '↑' : '↕'}</span></button></th>;
  }
  const sortBasisById = new Map(sortBasis.map(row => [row.id, row]));
  const filtered = (snapshot?.rows ?? []).filter(r => r.asset.toUpperCase().includes(query.trim().toUpperCase()) && (status === 'all' || r.status === status) && (!onlyFavorites || favorites.includes(r.id))).sort((a, b) => {
    if (!realtimeSort) { a = sortBasisById.get(a.id) ?? a; b = sortBasisById.get(b.id) ?? b; }
    const direction = sortDirection === 'desc' ? -1 : 1;
    if (sort === 'status') return direction * (statusPriority[a.status] - statusPriority[b.status] || a.elapsedSeconds - b.elapsedSeconds) || a.id.localeCompare(b.id);
    const value = (r: SpreadDirection) => sort === 'spread' ? marketDeviation(r) : sort === 'oi' ? r.averageOiUsd : sort === 'capacity' ? r.capacity ? Number(r.capacity.amountUsd) : null : r.deviationBps;
    const av = value(a), bv = value(b);
    // 缺失值在两个排序方向下均置底，零和负数按有效数值处理。
    if (av === null || bv === null) return av === bv ? a.id.localeCompare(b.id) : av === null ? 1 : -1;
    return direction * (av - bv) || a.id.localeCompare(b.id);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / 30));
  const currentPage = Math.min(page, totalPages);
  const selectedRow = snapshot?.rows.find(r => r.id === selected);
  return <div className="sp-prototype sp-live"><main>
    <div className="sp-heading"><div><p>MARKET MONITOR / 永续跨所</p><h1>价差监控<span>按双边市价成交均价计算</span></h1></div><div className="sp-heading-note">{connected ? '监控数据已连接' : '正在连接 / 数据暂不可用'}<br/>{snapshot ? `${snapshot.coverage.validSymbols} / ${snapshot.coverage.symbols} 个交易对盘口有效` : '正在发现交易对'}</div></div>
    {(error || snapshot?.coverage.error) && <p className="sp-warning" role="alert">{error || snapshot?.coverage.error}</p>}
    {!connected && snapshot && <p className="sp-warning">连接未就绪，下方保留最近快照；请勿视为当前可成交行情。</p>}
    {snapshot ? <>
      <div className="sp-overview"><button onClick={() => { setStatus('ready'); setPage(1); }}><span>条件达标</span><strong>{snapshot.rows.filter(r => r.status === 'ready').length}<small>个方向</small></strong></button><button onClick={() => { setStatus('watching'); setPage(1); }}><span>观察中</span><strong>{snapshot.rows.filter(r => r.status === 'watching').length}<small>个方向</small></strong></button><div><span>监控范围</span><strong>{snapshot.coverage.assets}<small>个标的 · {snapshot.rows.length} 个方向</small></strong></div><div><span>市价成交口径</span><strong>{money(snapshot.settings.amountUsd)}<small>单边名义金额</small></strong></div></div>
      <Settings key={JSON.stringify(snapshot.settings)} settings={snapshot.settings} saving={saving} onSave={save}/>
      {snapshot.settings.minMarketCapMillions > 0 && <p className="sp-muted" role="status">流通市值来源：<a href="https://www.coingecko.com/" target="_blank" rel="noreferrer">CoinGecko</a> · 每 10 分钟刷新，超过 30 分钟按未知处理；未知或同名币身份不明确时不参与监控。{snapshot.marketCapStatus ? `当前 ${snapshot.marketCapStatus.unknownAssets} 个多所标的市值未知。` : '正在加载市值。'}{snapshot.marketCapStatus?.error}</p>}
      <section className="sp-notifications"><div className="sp-notification-head"><div><h3>价差推送 <small>Bark</small></h3><p>每轮达标提醒一次，价差恢复后可再次提醒。后台持续更新所选窗口 K 线基准，关闭推送只停止通知。</p></div><div className="sp-notification-actions"><button role="switch" aria-label="价差推送开关" aria-checked={snapshot.settings.notificationsEnabled} disabled={saving || (!snapshot.barkConfigured && !snapshot.settings.notificationsEnabled)} className={snapshot.settings.notificationsEnabled ? 'active' : ''} onClick={() => void save({ ...snapshot.settings, notificationsEnabled: !snapshot.settings.notificationsEnabled }).catch(() => undefined)}>{snapshot.settings.notificationsEnabled ? '推送已开启' : '推送已关闭'}</button><button type="button" disabled={testingPush || !snapshot.barkConfigured} onClick={() => void testPush()}>{testingPush ? '发送中…' : '发送测试通知'}</button><button title="推送记录" aria-label="查看推送记录" onClick={() => setShowNotices(true)}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z M10 21h4"/></svg></button></div></div>{pushFeedback && <p className="sp-muted" role="status">{pushFeedback}</p>}{!snapshot.barkConfigured && <p className="sp-muted">Bark 未配置：在本地设置 BARK_DEVICE_KEY 后重启后端，设备 Key 不会发送给页面。</p>}</section>
      {saveError && <p role="alert" className="sp-warning">{saveError}</p>}
      <div className="sp-results-head"><div><input aria-label="搜索标的" placeholder="搜索币种" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }}/><select aria-label="状态筛选" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">全部状态</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><div><button aria-pressed={onlyFavorites} className={onlyFavorites ? 'active' : ''} onClick={() => { setOnlyFavorites(v => !v); setPage(1); }}>★ 仅关注</button><select aria-label="排序" value={sort} onChange={e => { setSort(e.target.value as SortColumn); setSortDirection('desc'); setSortBasis(snapshot.rows); setPage(1); }}>{Object.entries(sortColumns).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button type="button" aria-label="切换排序方向" onClick={() => { setSortDirection(value => value === 'desc' ? 'asc' : 'desc'); setSortBasis(snapshot.rows); setPage(1); }}>{sortDirection === 'desc' ? '降序 ↓' : '升序 ↑'}</button><button type="button" aria-pressed={realtimeSort} onClick={() => { setRealtimeSort(value => !value); setSortBasis(snapshot.rows); }}>{realtimeSort ? '实时排序：开' : '实时排序：关'}</button>{!realtimeSort && <button type="button" onClick={() => { setSortBasis(snapshot.rows); setPage(1); }}>更新排序</button>}</div></div>
      <p className="sp-muted">{filtered.length} 个方向 · {realtimeSort ? '实时排序开启，状态变化可能使方向移到其他页' : '排序已固定，行情与状态实时更新；点击更新排序重新排列'} · 点击表头切换排序，缺失值置底 · 分页不影响后台监控 · 市价偏离 = 按单边 {money(snapshot.settings.amountUsd)} 估算的成交价差 − 历史均值；参考偏离 = 当前中间价价差 − 同一历史均值</p>
      <div className="sp-table-wrap"><table className="sp-table"><colgroup><col style={{ width: '14%' }}/><col style={{ width: '19%' }}/><col style={{ width: '19%' }}/><col style={{ width: '14%' }}/><col style={{ width: '12%' }}/><col style={{ width: '16%' }}/><col style={{ width: '6%' }}/></colgroup><thead><tr><th>标的 / 买入 → 卖出</th>{sortHeader('spread')}{sortHeader('deviation')}{sortHeader('oi')}{sortHeader('capacity')}{sortHeader('status')}<th>操作</th></tr></thead><tbody>{filtered.slice((currentPage - 1) * 30, currentPage * 30).map(r => {
        const cached = r.status === 'stale' ? r.lastValid : undefined;
        const display = cached ?? r;
        const executionDeviation = marketDeviation(display);
        const age = cached ? Math.max(0, Math.floor((Date.parse(snapshot.updatedAt) - Date.parse(cached.updatedAt)) / 1000)) : 0;
        return <tr key={r.id} className={cached ? 'sp-cached-row' : undefined}><td><div className="sp-asset"><button className="sp-asset-name" onClick={() => { setSelected(r.id); dialog.current?.showModal(); }}><b>{r.asset}<small> PERP</small></b></button><span><VenueLink venue={r.buyVenue} symbol={r.buySymbol} nativeMarket={r.buyNativeMarket}/> <em>买</em> → <VenueLink venue={r.sellVenue} symbol={r.sellSymbol} nativeMarket={r.sellNativeMarket}/> <i>卖</i></span></div></td><td className="sp-quote-cell"><strong>{signed(executionDeviation)}{cached && <span className="sp-quote-age" title={`最近有效盘口：${cached.updatedAt}；仅供参考，不参与提醒`}>上次有效 · {age} 秒前</span>}</strong><small>市价价差 {signed(display.spreadBps)}</small><small>{spreadHistoryLabel(snapshot.settings.historyDays)}均值 {signed(display.meanBps)}</small></td><td className="sp-quote-cell"><strong>{signed(display.deviationBps)}{cached && <span className="sp-quote-age" title={`最近有效盘口：${cached.updatedAt}；仅供参考，不参与提醒`}>上次有效 · {age} 秒前</span>}</strong><small>参考价差 {signed(display.referenceBps ?? null)}</small><small>{spreadHistoryLabel(snapshot.settings.historyDays)}均值 {signed(display.meanBps)}</small></td><td><span title={money(r.averageOiUsd)}>{compactMoney(r.averageOiUsd)}</span>{snapshot.settings.minMarketCapMillions > 0 && <small title={`流通市值 ${money(r.marketCapUsd)}`}>流通市值 {compactMoney(r.marketCapUsd)}</small>}</td><td className="sp-quote-cell">{money(display.capacity?.amountUsd)}<small>{display.capacity?.depthLimited ? '当前已知盘口上限' : display.capacity ? `偏离 ≥ ${snapshot.settings.thresholdBps} BPS` : '详情中检查盘口'}</small></td><td><span className={`sp-status ${r.status === 'ready' ? 'ready' : ''}`} title={r.reason ?? undefined}>{statusLabel(r)}</span><small title={r.status === 'warming' ? '历史覆盖率：双方有效已收盘小时 K 线的交集占所选窗口的比例' : '累计有效达标时间；数据过期或历史不足时暂停，参考偏离低于阈值时清零；容量不影响计时'}>{r.status === 'warming' ? `${(r.historyHours / 24).toFixed(2)} / ${snapshot.settings.historyDays} 天 · 历史覆盖 ${(r.coverage * 100).toFixed(0)}%` : `${r.elapsedSeconds} / ${snapshot.settings.durationSeconds} 秒${r.status === 'stale' || r.status === 'insufficient_depth' ? '（暂停）' : ''}`}</small>{(r.status !== 'warming' || r.reason) && <small className="sp-stale-reason" title={r.reason ?? '双方有效已收盘小时 K 线的交集占所选窗口的比例'}>{r.status !== 'warming' && `历史覆盖 ${(r.coverage * 100).toFixed(0)}%${r.reason ? ' · ' : ''}`}{r.reason}</small>}</td><td><button aria-label={`收藏 ${r.asset} ${r.buyVenue} ${r.sellVenue}`} aria-pressed={favorites.includes(r.id)} onClick={() => star(r.id)}>{favorites.includes(r.id) ? '★' : '☆'}</button><button aria-label={`查看 ${r.asset} ${r.buyVenue} ${r.sellVenue} 详情`} onClick={() => { setSelected(r.id); dialog.current?.showModal(); }}>↗</button></td></tr>; })}</tbody></table>{!filtered.length && <div className="sp-empty">没有符合条件的方向，请调整筛选；首次连接时需等待目录与盘口加载。</div>}</div>
      <div className="sp-pagination"><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage} / {totalPages}</span><button disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>下一页</button></div>
      <p className="sp-footnote">短暂异常时灰显最近 60 秒内的有效值，并标注数据年龄，仅供参考；计时和提醒暂停，恢复后继续。容量为当前盘口估算，未扣手续费；USD、USDT、USDC 按 1:1 名义口径直接比较，不做汇率换算。历史均值取最近 {spreadHistoryLabel(snapshot.settings.historyDays)}已收盘小时线，按时间对齐并等权平均，保存在内存。参考偏离每秒更新；双边 K 线覆盖达到 90% 且最新小时完整后参与提醒，无需等待本地积累完整窗口。观察、计时和推送仅按参考偏离阈值判断；市价成交估算与容量只作提示，深度不足不拦截价差信号，不代表可成交或净收益。</p>
    </> : <div className="sp-empty" role="status">正在加载监控设置与交易对…</div>}
    <dialog ref={dialog} aria-label="价差方向详情" className="sp-dialog" onClose={() => setSelected(null)} onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }}><button className="sp-close" aria-label="关闭详情" onClick={() => dialog.current?.close()}>关闭 ×</button>{selectedRow && snapshot ? <SpreadDetail key={`${selectedRow.id}:${snapshot.settings.amountUsd}`} row={selectedRow} settings={snapshot.settings} connected={connected}/> : selected ? <p className="sp-details">该方向已不在监控范围内。</p> : null}</dialog>
    {showNotices && <NoticeDialog onClose={() => setShowNotices(false)}/>}
  </main></div>;
}

function Settings({ settings, saving, onSave }: { settings: SpreadSettings; saving: boolean; onSave: (settings: SpreadSettings) => Promise<void> }) {
  const [draft, setDraft] = useState(() => restoreDraft(settings));
  useEffect(() => { writeLocal(settingsDraftKey, { base: settings, draft }); }, [settings, draft]);
  const [error, setError] = useState('');
  return <form className="sp-filters" onSubmit={e => { e.preventDefault(); const parsed = SpreadSettingsSchema.safeParse(draft); if (!parsed.success) { setError('请至少选择两家交易所，并填写有效金额、阈值和时间。'); return; } setError(''); void onSave(parsed.data).catch(() => undefined); }}>
    <div className="sp-oi-filter" role="group" aria-label="最低平均持仓量"><span className="sp-oi-label">最低平均持仓量</span>{[0,1,5,10,50].map(value => <button type="button" key={value} aria-pressed={draft.minOiMillions === value} className={draft.minOiMillions === value ? 'active' : ''} onClick={() => setDraft({ ...draft, minOiMillions: value })}>{value ? `$${value}M` : '不限'}</button>)}<label className="sp-oi-custom"><span>$</span><input aria-label="自定义最低平均持仓量（百万美元）" type="number" min="0" step="any" value={draft.minOiMillions} onChange={e => setDraft({ ...draft, minOiMillions: Number(e.target.value) })}/><span>M</span></label></div>
    <div className="sp-oi-filter" role="group" aria-label="最低流通市值"><span className="sp-oi-label">最低流通市值</span>{[[0, '不限'], [50, '5000 万美元'], [100, '1 亿美元'], [500, '5 亿美元'], [1000, '10 亿美元']].map(([value, label]) => <button type="button" key={value} aria-pressed={draft.minMarketCapMillions === value} className={draft.minMarketCapMillions === value ? 'active' : ''} onClick={() => setDraft({ ...draft, minMarketCapMillions: Number(value) })}>{label}</button>)}<label className="sp-oi-custom"><span>$</span><input aria-label="自定义最低流通市值（百万美元）" type="number" min="0" max="1000000000" step="any" value={draft.minMarketCapMillions} onChange={e => setDraft({ ...draft, minMarketCapMillions: Number(e.target.value) })}/><span>M</span></label></div>
    <p className="sp-muted">平均持仓量是所选交易所有效未平仓合约美元价值的平均值；流通市值是币价 × 流通量。市值单位 M = 百万美元，100 M = 1 亿美元。</p>
    <div className="sp-filter-line"><label>历史窗口<select aria-label="历史窗口" value={draft.historyDays} onChange={e => setDraft({ ...draft, historyDays: SpreadSettingsSchema.shape.historyDays.parse(Number(e.target.value)) })}>{SPREAD_HISTORY_DAYS.map(days => <option key={days} value={days}>{spreadHistoryLabel(days)}</option>)}</select></label><label>目标单边金额（USD）<input type="number" min="10" max="100000000" step="any" value={draft.amountUsd} onChange={e => setDraft({ ...draft, amountUsd: Number(e.target.value) })}/></label><label>触发偏离阈值（BPS）<input type="number" min="0.1" max="10000" step="any" value={draft.thresholdBps} onChange={e => setDraft({ ...draft, thresholdBps: Number(e.target.value) })}/></label><label>累计达标时间（秒）<input type="number" min="1" max="86400" value={draft.durationSeconds} onChange={e => setDraft({ ...draft, durationSeconds: Number(e.target.value) })}/></label><button disabled={saving} type="submit">{saving ? '保存中…' : '应用监控设置'}</button></div>
    <div className="sp-venues"><span>交易所</span>{SPREAD_VENUES.map(v => <button type="button" key={v} aria-pressed={draft.venues.includes(v)} className={draft.venues.includes(v) ? 'active' : ''} onClick={() => setDraft({ ...draft, venues: draft.venues.includes(v) ? draft.venues.filter(x => x !== v) : [...draft.venues, v] })}>{draft.venues.includes(v) ? '✓ ' : ''}{venueName(v)}</button>)}</div>
    <p className="sp-muted">交易所、持仓量和市值共同决定后台监控与推送范围；历史基准与成交金额无关；市值门槛、历史窗口、成交金额、阈值或时间修改后重新累计达标时间。点击应用后生效。</p>{error && <p role="alert">{error}</p>}
  </form>;
}

function SpreadDetail({ row, settings, connected }: { row: SpreadDirection; settings: SpreadSettings; connected: boolean }) {
  const [amount, setAmount] = useState(String(settings.amountUsd));
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.spreadDetail>> | null>(null);
  const [error, setError] = useState('');
  const requestNumber = useRef(0);
  useEffect(() => {
    let disposed = false; const version = ++requestNumber.current; let busy = false;
    const load = async () => {
      if (busy || !connected || Number(amount) < 10 || Number(amount) > 1e8 || !Number.isFinite(Number(amount))) return;
      busy = true;
      try { const data = await api.spreadDetail(row.id, Number(amount)); if (!disposed && requestNumber.current === version) { setDetail(data); setError(''); } }
      catch { if (!disposed) { setDetail(null); setError('盘口估算暂不可用，请稍后重试'); } }
      finally { busy = false; }
    };
    const debounce = setTimeout(() => void load(), 250); const timer = setInterval(() => void load(), 3000);
    return () => { disposed = true; clearTimeout(debounce); clearInterval(timer); };
  }, [row.id, amount, connected]);
  const estimate = connected ? detail?.estimate : null;
  const capacity = connected ? detail?.capacity : null;
  const fund = [row.buyFunding, row.sellFunding];
  return <div className="sp-details"><div className="sp-detail-title"><div><small>永续合约 · {statusLabel(row)}</small><h2>{row.asset}<span> / PERP</span></h2></div></div><div className="sp-direction"><span><small>买入 / 做多</small>{venueName(row.buyVenue)}</span><b>→</b><span><small>卖出 / 做空</small>{venueName(row.sellVenue)}</span></div><div className="sp-detail-metrics"><div><small>市价偏离 / 单边 {money(settings.amountUsd)}</small><strong>{signed(marketDeviation(row))} <small>BPS</small></strong></div><div><small>参考价差较{spreadHistoryLabel(settings.historyDays)} K 线均值</small><strong>{signed(row.deviationBps)} <small>BPS</small></strong></div></div>{row.reason && <p className="sp-warning">{row.reason}</p>}
    <SpreadMonitorChart row={row} threshold={settings.thresholdBps} amount={settings.amountUsd} historyDays={settings.historyDays}/>
    <section><h3>市价成交估算</h3><label className="sp-amount">目标单边金额（USD）<input aria-label="目标成交金额" type="number" min="10" max="100000000" value={amount} onChange={e => { setDetail(null); setAmount(e.target.value); }}/></label><p className="sp-muted">这里调整金额只影响本次估算，不修改后台监控金额。</p>{error && <p role="alert">{error}</p>}<div className="sp-depth-result"><b>{estimate ? '当前盘口可足额承接' : '等待有效盘口或深度不足，暂无法足额估算'}</b><span>两边使用相同基础币数量；估算不包含手续费和提交订单后的行情变化。</span></div><div className="sp-depth-grid"><span>买入均价（USD）<b>{estimate ? Number(estimate.buyVwap).toLocaleString('en-US', { maximumSignificantDigits: 10 }) : '—'}</b></span><span>卖出均价（USD）<b>{estimate ? Number(estimate.sellVwap).toLocaleString('en-US', { maximumSignificantDigits: 10 }) : '—'}</b></span><span>共同数量（{row.asset}）<b>{estimate?.quantity ?? '—'}</b></span><span>成交后价差<b>{signed(estimate?.spreadBps ?? null)} BPS</b></span><span>冲击成本<b>{signed(estimate?.impactBps ?? null)} BPS</b></span><span>估算容量<b>{money(capacity?.amountUsd)}</b></span></div><p className="sp-muted">保持市价成交价差 ≥ 历史参考均值 + {settings.thresholdBps} BPS{capacity?.depthLimited ? ' · 受当前已知盘口深度限制' : ''}</p></section>
    <section><h3>资金费率 <small>8 小时等效</small></h3><div className="sp-funding">{fund.map((f, i) => <span key={i}>{venueName(i ? row.sellVenue : row.buyVenue)}<b>{rate(f.rate8h)}</b><small>原始 {rate(f.rate)} / {f.hours ?? '—'} 小时</small><small>下次 {f.nextAt ? new Date(f.nextAt).toLocaleString('zh-CN') : '—'}</small></span>)}<span>方向净费率<b>{fund[0].rate8h !== null && fund[1].rate8h !== null ? rate(String(Number(fund[1].rate8h) - Number(fund[0].rate8h))) : '—'}</b><small>正值表示净收取</small></span></div></section>
  </div>;
}

function NoticeDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [notices, setNotices] = useState<SpreadNotice[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); let disposed = false; const load = async () => { try { const data = await api.spreadNotices(); if (!disposed) { setNotices(data.notices); setError(''); } } catch { if (!disposed) setError('通知记录加载失败'); } }; void load(); const timer = setInterval(() => void load(), 5000); return () => { disposed = true; clearInterval(timer); }; }, []);
  const noticeLabels = { pending: '等待发送', sent: 'Bark 已接收', failed: '发送失败 / 已取消', unknown: '结果未知，不自动重发' };
  return <dialog ref={ref} className="sp-notice-dialog" aria-labelledby="sp-notice-heading" onClose={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><header><div><h2 id="sp-notice-heading">推送记录</h2><p>保留 30 天，展示最近 100 条</p></div><button aria-label="关闭推送记录" onClick={onClose}>关闭 ×</button></header>{error && <p role="alert">{error}</p>}<div className="sp-notice-log">{notices === null ? <p>加载中…</p> : notices.length ? notices.map(n => <article key={n.id}><b>{n.title}</b><p style={{ whiteSpace: 'pre-line' }}>{n.body}</p><small>{new Date(n.createdAt).toLocaleString('zh-CN')} · {noticeLabels[n.status]}</small></article>) : <div className="sp-notice-empty">暂无推送记录</div>}</div></dialog>;
}
