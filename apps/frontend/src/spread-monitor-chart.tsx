import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { spreadHistoryLabel, type SpreadDirection, type SpreadHistoryPoint } from '@gate-crossex/shared-types';
import { api } from './api.js';
import { PriceDifferenceHistoryChart } from './charts.js';
import type { PriceDifferenceHistoryPoint } from './price-difference-history.js';
import { useLanguage } from './i18n.js';

const periods = [{ label: '1H', minutes: 60 }, { label: '4H', minutes: 240 }, { label: '1D', minutes: 1440 }];
export function SpreadMonitorChart({ row, threshold, amount, historyDays }: { row: SpreadDirection; threshold: number; amount: number; historyDays: number }) {
  const [period, setPeriod] = useState(60);
  return <section className="sp-interactive-chart"><div className="sp-section-head"><h3>历史参考价差（K 线）</h3><div className="sp-chart-periods">{periods.map(p => <button key={p.minutes} aria-pressed={period === p.minutes} className={period === p.minutes ? 'active' : ''} onClick={() => setPeriod(p.minutes)}>{p.label}</button>)}</div></div><History key={`${row.id}:${period}:${amount}:${historyDays}`} row={row} period={period} threshold={threshold} amount={amount} historyDays={historyDays}/></section>;
}
function History({ row, period, threshold, amount, historyDays }: { row: SpreadDirection; period: number; threshold: number; amount: number; historyDays: number }) {
  const { theme } = useLanguage();
  const [points, setPoints] = useState<SpreadHistoryPoint[]>([]);
  const [hovered, setHovered] = useState<PriceDifferenceHistoryPoint | null>(null);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(['mean', 'threshold', 'MA20']);
  const [reset, setReset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const active = useRef(true);
  const busy = useRef(false);
  const oldest = useRef<number | undefined>(undefined);
  const load = useCallback(async (older = false) => {
    if (busy.current || (older && !oldest.current)) return;
    busy.current = true;
    try {
      const result = await api.spreadHistory(row.id, period, older ? oldest.current : undefined, amount);
      if (!active.current) return;
      setPoints(previous => [...new Map([...previous, ...result.points].map(p => [p.time, p])).values()].sort((a, b) => a.time - b.time));
      if (result.points[0]) oldest.current = Math.min(oldest.current ?? Infinity, result.points[0].time);
      if (older) setHasMore(result.points.length === 500);
      setError('');
    } catch { if (active.current) setError('历史加载失败，请重试'); }
    finally { busy.current = false; }
  }, [row.id, period, amount]);
  useEffect(() => { active.current = true; void load(); const timer = setInterval(() => void load(), 15000); return () => { active.current = false; clearInterval(timer); }; }, [load]);
  const chartPoints = useMemo(() => points.map(p => ({ ...p, leftClose: 0, rightClose: 0 })), [points]);
  const overlays = useMemo(() => [
    ...row.meanBps === null ? [] : [{ id: 'mean', color: '#94a3b8', points: points.map(p => ({ time: p.time, value: row.meanBps! })) }, { id: 'threshold', color: '#b994f6', points: points.map(p => ({ time: p.time, value: row.meanBps! + threshold })) }],
    ...[5,10,20].map((n, i) => ({ id: `MA${n}`, color: ['#e8a317','#e33d79','#20abc4'][i], points: points.slice(n - 1).map((p, index) => ({ time: p.time, value: points.slice(index, index + n).reduce((s, v) => s + v.value, 0) / n })) })),
  ], [points, row.meanBps, threshold]);
  const visibleOverlays = useMemo(() => overlays.filter(o => visible.includes(o.id)), [overlays, visible]);
  const shown = hovered ?? points.at(-1);
  return <><div className="sp-chart-reading"><strong>{shown ? `${shown.value >= 0 ? '+' : ''}${shown.value.toFixed(2)}` : '—'} <small>BPS</small></strong><span>{shown ? new Date(shown.time).toLocaleString('zh-CN') : '正在加载交易所历史'}<small>已收盘小时线 · 双边收盘价差</small></span></div>
    <div className="sp-chart-legends">{overlays.map(o => <button key={o.id} aria-pressed={visible.includes(o.id)} className={visible.includes(o.id) ? '' : 'sp-line-hidden'} onClick={() => setVisible(v => v.includes(o.id) ? v.filter(x => x !== o.id) : [...v, o.id])}><i style={{ background: o.color }}/>{o.id === 'mean' ? `当前${spreadHistoryLabel(historyDays)}均值` : o.id === 'threshold' ? '参考偏离线' : o.id}</button>)}</div>
    <PriceDifferenceHistoryChart points={chartPoints} overlays={visibleOverlays} seriesKey={`${row.id}:${period}:${reset}`} visibleDurationMs={120 * period * 60000} theme={theme} locale="zh-CN" placeholder={error || `正在加载最近${spreadHistoryLabel(historyDays)}历史 K 线`} onHover={setHovered} onLoadMore={() => { if (hasMore) void load(true); }}/>
    <div className="sp-chart-help"><span>滚轮缩放 · 拖动平移 · 十字光标读数</span><button onClick={() => setReset(v => v + 1)}>回到最新</button><button disabled={!hasMore} onClick={() => void load(true)}>{hasMore ? '加载更早记录' : '已加载全部历史'}</button></div>{error && <p role="alert">{error}</p>}</>;
}
