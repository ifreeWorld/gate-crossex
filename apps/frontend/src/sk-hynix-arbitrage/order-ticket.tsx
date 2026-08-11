import type { SkHynixArbitragePosition } from '@gate-crossex/shared-types';
import type { DemoOrderCalculation } from './demo-model.js';
import type { SimulationPhase } from './execution-lanes.js';

interface OrderTicketProps {
  mode: 'OPEN' | 'CLOSE';
  notional: string;
  closeKind: 'ALL' | 'PARTIAL';
  closeShares: number;
  position: SkHynixArbitragePosition | null;
  calculation: DemoOrderCalculation;
  venue: string;
  phase: SimulationPhase;
  onMode: (mode: 'OPEN' | 'CLOSE') => void;
  onNotional: (value: string) => void;
  onCloseKind: (kind: 'ALL' | 'PARTIAL') => void;
  onCloseShares: (shares: number) => void;
  onSimulate: () => void;
}

export function OrderTicket(props: OrderTicketProps) {
  const availableShares = Math.floor(Number(props.position?.remainingEquityQuantity ?? '0'));
  const busy = props.phase === 'submitting' || props.phase === 'acknowledged';
  const quickShares = [0.25, 0.5, 0.75, 1].map((ratio) => ({ ratio, shares: Math.max(1, Math.floor(availableShares * ratio)) }));
  return <aside className="skha-ticket skha-panel terminal-panel">
    <header><div><p className="eyebrow">模拟下单</p><h2>下单</h2></div><small>一个动作，同时模拟两腿</small></header>
    <div className="skha-order-body">
      <div className="skha-mode" role="tablist" aria-label="操作方向">
        <button role="tab" aria-selected={props.mode === 'OPEN'} onClick={() => props.onMode('OPEN')}>开仓</button>
        <button role="tab" aria-selected={props.mode === 'CLOSE'} onClick={() => props.onMode('CLOSE')}>平仓</button>
      </div>
      {props.mode === 'OPEN' ? <div className="skha-order-field"><label htmlFor="skha-notional"><span>目标名义金额</span><small>USDT</small></label><div><input id="skha-notional" inputMode="decimal" value={props.notional} onChange={(event) => props.onNotional(event.target.value)} /><b>USDT</b></div><div className="skha-quick">{['500', '1000', '2500', '5000'].map((amount) => <button type="button" onClick={() => props.onNotional(amount)} key={amount}>{Number(amount).toLocaleString()}</button>)}</div></div> : <>
        <div className="skha-close-position"><header><span>当前策略持仓</span><strong>{props.position?.id ?? '无持仓'}</strong></header><div><span>IBKR · 000660 多头</span><strong>{availableShares} 股</strong></div><div><span>{props.position?.perpVenue ?? '—'} · SKHYNIX 空头</span><strong>{props.position?.remainingPerpQuantity ?? '0'}</strong></div><div><span>当前净敞口</span><strong>{props.position?.residualEconomicExposure ?? '—'}</strong></div></div>
        <div className="skha-close-kind" role="group" aria-label="平仓方式"><button type="button" aria-pressed={props.closeKind === 'ALL'} onClick={() => props.onCloseKind('ALL')}>全部平仓</button><button type="button" aria-pressed={props.closeKind === 'PARTIAL'} onClick={() => props.onCloseKind('PARTIAL')}>部分平仓</button></div>
        {props.closeKind === 'PARTIAL' && <div className="skha-partial"><label htmlFor="skha-close-shares"><span>IBKR 平仓股数</span><small>可平 1–{availableShares} 股</small></label><div className="skha-share-input"><input id="skha-close-shares" type="number" min="1" max={availableShares} step="1" value={props.closeShares} onChange={(event) => props.onCloseShares(Number(event.target.value))} /><b>股</b></div><div className="skha-quick">{quickShares.map(({ ratio, shares }) => <button type="button" aria-pressed={props.closeShares === shares} onClick={() => props.onCloseShares(shares)} key={ratio}>{ratio === 1 ? '全部' : `${ratio * 100}%`} · {shares} 股</button>)}</div><div className="skha-close-remaining"><span>平仓后剩余</span><strong>{props.calculation.remainingEquityShares === 0 ? '无剩余持仓' : `IBKR ${props.calculation.remainingEquityShares} 股 · 永续 ${props.calculation.remainingPerpQuantity}`}</strong></div></div>}
        <p className="skha-close-scope">✓ 只读取本策略模拟持仓，不影响账户内其他持仓</p>
      </>}
      <div className="skha-execution-mode"><span><strong>同步保护限价</strong><small>根据当前模拟盘口生成两腿价格</small></span><b>最大滑点 20 bps</b></div>
      <div className="skha-calculation">
        <div><span>IBKR {props.calculation.equitySide}</span><strong>{props.calculation.equityShares} 股 · {props.calculation.equityNotionalUsdt} USDT</strong></div>
        <div><span>{props.venue} {props.calculation.perpSide}</span><strong>{props.calculation.perpQuantity} · {props.calculation.perpNotionalUsdt} USDT</strong></div>
        <div><span>名义金额偏差</span><strong>{Number(props.calculation.mismatchUsdt) >= 0 ? '+' : ''}${props.calculation.mismatchUsdt} · {props.calculation.mismatchPct}%</strong></div>
        <div><span>汇率敞口</span><strong>${props.calculation.fxExposureUsd} USD · {props.calculation.remainingEquityShares === 0 ? '已解除' : '未对冲'}</strong></div>
        <div><span>交易所只减仓</span><strong>{props.calculation.reduceOnly ? '开启（平仓）' : '关闭（开仓）'}</strong></div>
      </div>
      <button type="button" className={`skha-action ${props.mode === 'CLOSE' ? 'close' : ''}`} disabled={busy || props.calculation.equityShares < 1} onClick={props.onSimulate}>{busy ? '模拟执行中…' : props.mode === 'OPEN' ? '模拟同时开仓' : props.closeKind === 'ALL' ? '模拟同时全部平仓' : `模拟同时平仓 ${props.calculation.equityShares} 股`}</button>
      <p className="skha-auto-note">仅演示双腿状态机，不会调用 IBKR 或 Gate 下单接口</p>
    </div>
  </aside>;
}
