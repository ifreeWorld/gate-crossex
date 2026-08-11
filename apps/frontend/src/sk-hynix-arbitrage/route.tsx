import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  SkHynixArbitrageCapabilities,
  SkHynixArbitrageOpportunity,
  SkHynixArbitragePosition,
  SkHynixArbitrageSpec,
} from '@gate-crossex/shared-types';
import { api } from '../api.js';
import { deriveDemoOrder } from './demo-model.js';
import { ExecutionLanes, type SimulationPhase } from './execution-lanes.js';
import { HealthStrip } from './health-strip.js';
import { HedgeMarketPanel } from './hedge-market-panel.js';
import { OpportunityTable } from './opportunity-table.js';
import { OrderTicket } from './order-ticket.js';
import { RecordsPanel, type RecordTab } from './records-panel.js';
import { SafetyStrip } from './safety-strip.js';
import './styles.css';

const MAX_SLIPPAGE_BPS = '20';

export function SkHynixArbitrageRoute() {
  const [capabilities, setCapabilities] = useState<SkHynixArbitrageCapabilities | null>(null);
  const [spec, setSpec] = useState<SkHynixArbitrageSpec | null>(null);
  const [opportunities, setOpportunities] = useState<SkHynixArbitrageOpportunity[]>([]);
  const [positions, setPositions] = useState<SkHynixArbitragePosition[]>([]);
  const [selected, setSelected] = useState<SkHynixArbitrageOpportunity | null>(null);
  const [mode, setMode] = useState<'OPEN' | 'CLOSE'>('OPEN');
  const [notional, setNotional] = useState('1000');
  const [horizonSeconds, setHorizonSeconds] = useState(86_400);
  const [closeKind, setCloseKind] = useState<'ALL' | 'PARTIAL'>('ALL');
  const [closeShares, setCloseShares] = useState(4);
  const [recordTab, setRecordTab] = useState<RecordTab>('positions');
  const [simulationPhase, setSimulationPhase] = useState<SimulationPhase>('idle');
  const [simulationId, setSimulationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const simulationTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const position = positions[0] ?? null;

  const loadOpportunities = useCallback(async (requestedNotional: string, horizon: number) => {
    const response = await api.skHynixArbitrageOpportunities({ requestedNotional, reportCurrency: 'USDT', horizonSeconds: horizon, maxSlippageBps: MAX_SLIPPAGE_BPS });
    setOpportunities(response.opportunities);
    setSelected((current) => response.opportunities.find((item) => item.perpSymbol === current?.perpSymbol) ?? response.opportunities[0] ?? null);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.skHynixArbitrageCapabilities(),
      api.skHynixArbitrageSpec(),
      api.skHynixArbitragePositions(),
      api.skHynixArbitrageOpportunities({ requestedNotional: '1000', reportCurrency: 'USDT', horizonSeconds: 86_400, maxSlippageBps: MAX_SLIPPAGE_BPS }),
    ]).then(([nextCapabilities, nextSpec, nextPositions, nextOpportunities]) => {
      if (!active) return;
      setCapabilities(nextCapabilities);
      setSpec(nextSpec);
      setPositions(nextPositions.items);
      setOpportunities(nextOpportunities.opportunities);
      setSelected(nextOpportunities.opportunities[0] ?? null);
      setCloseShares(Math.max(1, Math.floor(Number(nextPositions.items[0]?.remainingEquityQuantity ?? '1') / 2)));
    }).catch(() => {
      if (active) setError('无法读取 SK 海力士策略模拟数据');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      for (const timer of simulationTimers.current) clearTimeout(timer);
    };
  }, []);

  const calculation = useMemo(() => selected ? deriveDemoOrder({
    mode,
    opportunity: selected,
    requestedNotional: notional,
    position,
    closeShares: mode === 'CLOSE' ? closeKind === 'ALL' ? Number(position?.remainingEquityQuantity ?? '0') : closeShares : null,
  }) : null, [selected, mode, notional, position, closeKind, closeShares]);

  function resetSimulation() {
    for (const timer of simulationTimers.current) clearTimeout(timer);
    simulationTimers.current = [];
    setSimulationPhase('idle');
    setSimulationId(null);
  }

  async function refreshOpportunities(nextHorizon = horizonSeconds) {
    setError(null);
    resetSimulation();
    try {
      await loadOpportunities(notional, nextHorizon);
    } catch {
      setError('目标金额无效或模拟行情读取失败');
    }
  }

  function changeHorizon(value: number) {
    setHorizonSeconds(value);
    void refreshOpportunities(value);
  }

  function changeMode(nextMode: 'OPEN' | 'CLOSE') {
    setMode(nextMode);
    resetSimulation();
    if (nextMode === 'CLOSE' && position) {
      const held = opportunities.find((item) => item.perpSymbol === position.perpSymbol);
      if (held) setSelected(held);
    }
  }

  function simulateExecution() {
    if (!calculation || simulationPhase === 'submitting' || simulationPhase === 'acknowledged') return;
    resetSimulation();
    const id = `SIM-${Date.now().toString().slice(-8)}`;
    setSimulationId(id);
    setSimulationPhase('submitting');
    setRecordTab('orders');
    simulationTimers.current = [
      setTimeout(() => setSimulationPhase('acknowledged'), 350),
      setTimeout(() => {
        setSimulationPhase('filled');
        setRecordTab('history');
      }, 900),
    ];
  }

  if (loading || !selected || !calculation) return <div className="route-loading">正在载入 SK 海力士模拟策略…</div>;

  return <div className="alternate-view skha-view skha-demo">
    <section className="view-heading skha-heading"><div><p className="eyebrow">SK Hynix Carry</p><h1>SK 海力士资金费率套利</h1><p>IBKR 韩国股票 000660 多头 ↔ 交易所 SKHYNIX 永续空头</p></div><span className="skha-readonly"><i /> Paper · 本地模拟交互</span></section>
    <HealthStrip capabilities={capabilities} />
    {error && <div className="skha-error" role="alert">{error}</div>}

    <section className="skha-panel skha-ranking terminal-panel" aria-label="资金费率机会排行">
      <header><div><p className="eyebrow">资金费与可执行价差</p><h2>机会排行</h2><small>先把 IBKR 韩元价格归一化为 USDT，再按持有周期估算收益</small></div><div className="skha-ranking-controls"><label><span>参考本金</span><div><input aria-label="排行参考本金" value={notional} onChange={(event) => setNotional(event.target.value)} /><b>USDT</b></div></label><label><span>预计持有周期</span><select aria-label="预计持有周期" value={horizonSeconds} onChange={(event) => changeHorizon(Number(event.target.value))}><option value={28_800}>持有 8 小时</option><option value={86_400}>持有 24 小时</option><option value={604_800}>持有 7 天</option></select></label><button type="button" onClick={() => void refreshOpportunities()}>重新计算</button></div></header>
      <OpportunityTable opportunities={opportunities} selectedSymbol={selected.perpSymbol} onSelect={(item) => { setSelected(item); setNotional(item.requestedNotional); resetSimulation(); }} />
      <footer><span><strong>预计收益</strong> = 开仓价差 + 持有期资金费 − 双边费用、滑点和换汇成本</span><span>所有数值均为固定模拟数据，不代表确定利润</span></footer>
    </section>

    <section className="skha-main-grid">
      <main><HedgeMarketPanel opportunity={selected} opportunities={opportunities} spec={spec} calculation={calculation} mode={mode} onSelectSymbol={(symbol) => { const item = opportunities.find((entry) => entry.perpSymbol === symbol); if (item) { setSelected(item); resetSimulation(); } }} /><ExecutionLanes calculation={calculation} venue={selected.perpVenue} phase={simulationPhase} /></main>
      <OrderTicket mode={mode} notional={notional} closeKind={closeKind} closeShares={closeShares} position={position} calculation={calculation} venue={selected.perpVenue} phase={simulationPhase} onMode={changeMode} onNotional={(value) => { setNotional(value); resetSimulation(); }} onCloseKind={(kind) => { setCloseKind(kind); if (kind === 'ALL') setCloseShares(Number(position?.remainingEquityQuantity ?? '0')); resetSimulation(); }} onCloseShares={(shares) => { setCloseShares(shares); resetSimulation(); }} onSimulate={simulateExecution} />
    </section>
    <SafetyStrip />
    <RecordsPanel tab={recordTab} onTab={setRecordTab} position={position} opportunity={selected} calculation={calculation} phase={simulationPhase} simulationId={simulationId} />
  </div>;
}
