import type { DemoOrderCalculation } from './demo-model.js';

export type SimulationPhase = 'idle' | 'submitting' | 'acknowledged' | 'filled';

function phaseText(phase: SimulationPhase): string {
  if (phase === 'submitting') return '模拟提交中';
  if (phase === 'acknowledged') return '已确认 · 等待成交';
  if (phase === 'filled') return '模拟成交完成';
  return '等待同时发送';
}

export function ExecutionLanes({ calculation, venue, phase }: { calculation: DemoOrderCalculation; venue: string; phase: SimulationPhase }) {
  const active = phase !== 'idle';
  return <section className="skha-track skha-panel terminal-panel" aria-label="双腿同步轨道" aria-live="polite">
    <header><div><p className="eyebrow">同步执行</p><h2>双腿同步轨道</h2></div><small>{phase === 'filled' ? '模拟执行完成' : '不存在人工确认步骤'}</small></header>
    <div className="skha-track-body">
      <div className={`skha-lane ${active ? phase : ''}`}><span className="skha-side buy">{calculation.equitySide}</span><strong>IBKR · 000660</strong><i /><small>{phaseText(phase)}</small></div>
      <div className={`skha-lane ${active ? phase : ''}`}><span className="skha-side sell">{calculation.perpSide}</span><strong>{venue} · SKHYNIX 永续</strong><i /><small>{phaseText(phase)}</small></div>
      <div className={`skha-track-result ${phase === 'filled' ? 'done' : ''}`}><span>两腿使用同一模拟执行批次和行情快照</span><strong>{phase === 'filled' ? '模拟执行完成 · 未发送真实订单' : '未产生真实敞口'}</strong></div>
    </div>
  </section>;
}
