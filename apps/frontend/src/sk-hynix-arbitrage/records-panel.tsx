import type { SkHynixArbitrageOpportunity, SkHynixArbitragePosition } from '@gate-crossex/shared-types';
import type { DemoOrderCalculation } from './demo-model.js';
import type { SimulationPhase } from './execution-lanes.js';
import { formatSignedMoney } from './calculations.js';

export type RecordTab = 'positions' | 'orders' | 'history';

interface RecordsPanelProps {
  tab: RecordTab;
  onTab: (tab: RecordTab) => void;
  position: SkHynixArbitragePosition | null;
  opportunity: SkHynixArbitrageOpportunity;
  calculation: DemoOrderCalculation;
  phase: SimulationPhase;
  simulationId: string | null;
}

export function RecordsPanel(props: RecordsPanelProps) {
  const currentOrderCount = props.phase === 'submitting' || props.phase === 'acknowledged' ? 2 : 0;
  return <section className="skha-records skha-panel terminal-panel" aria-label="策略交易记录">
    <div className="skha-record-tabs" role="tablist" aria-label="策略交易记录">
      <button role="tab" aria-selected={props.tab === 'positions'} onClick={() => props.onTab('positions')}>持仓 <span>({props.position ? 2 : 0})</span></button>
      <button role="tab" aria-selected={props.tab === 'orders'} onClick={() => props.onTab('orders')}>当前委托 <span>({currentOrderCount})</span></button>
      <button role="tab" aria-selected={props.tab === 'history'} onClick={() => props.onTab('history')}>历史成交</button>
    </div>
    {props.tab === 'positions' && (props.position ? <>
      <div className="skha-record-summary"><div><span>策略</span><strong>{props.position.id}</strong></div><div><span>策略实时净盈亏</span><strong className="positive">{formatSignedMoney(props.position.netPnl)}</strong></div><div><span>已结算资金费</span><strong className="positive">{formatSignedMoney(props.position.fundingCashflow)}</strong></div><div><span>手续费</span><strong>-${props.position.commissionsAndFees}</strong></div><div><span>剩余净敞口</span><strong>{props.position.residualEconomicExposure}</strong></div><div><span>状态</span><strong>● 对冲模拟正常</strong></div></div>
      <div className="skha-record-table-wrap"><table className="skha-record-table" aria-label="策略持仓"><thead><tr><th>合约</th><th>平台</th><th>方向</th><th>数量</th><th>平均开仓价</th><th>当前可执行价</th><th>已结算资金费</th><th>手续费</th><th>净盈亏</th></tr></thead><tbody>
        <tr><td><strong>000660</strong><small>KRX 股票腿</small></td><td>IBKR</td><td><em>多头</em></td><td>{props.position.remainingEquityQuantity} 股</td><td>{props.position.equityAverageEntryPrice}</td><td>Bid {props.opportunity.equityQuote.bidUsdt}</td><td>—</td><td>—</td><td>—</td></tr>
        <tr><td><strong>{props.opportunity.perpSymbol}</strong><small>永续对冲腿</small></td><td>{props.position.perpVenue}</td><td><em className="short">空头</em></td><td>{props.position.remainingPerpQuantity}</td><td>{props.position.perpAverageEntryPrice}</td><td>Ask {props.opportunity.perpQuote.ask}</td><td className="positive">{formatSignedMoney(props.position.fundingCashflow)}</td><td>-${props.position.commissionsAndFees}</td><td className="positive">{formatSignedMoney(props.position.netPnl)}</td></tr>
      </tbody></table></div>
    </> : <div className="skha-record-empty">暂无策略持仓</div>)}
    {props.tab === 'orders' && (currentOrderCount === 0 ? <div className="skha-record-empty"><strong>暂无当前委托</strong><small>模拟双腿提交期间会在这里显示状态</small></div> : <div className="skha-record-table-wrap"><table className="skha-record-table" aria-label="当前委托"><thead><tr><th>合约</th><th>平台</th><th>方向</th><th>委托数量</th><th>委托类型</th><th>状态</th><th>批次</th></tr></thead><tbody>
      <tr><td><strong>000660</strong></td><td>IBKR</td><td>{props.calculation.equitySide}</td><td>{props.calculation.equityShares} 股</td><td>模拟保护限价</td><td>{props.phase}</td><td>{props.simulationId}</td></tr>
      <tr><td><strong>{props.opportunity.perpSymbol}</strong></td><td>{props.opportunity.perpVenue}</td><td>{props.calculation.perpSide}</td><td>{props.calculation.perpQuantity}</td><td>模拟保护限价</td><td>{props.phase}</td><td>{props.simulationId}</td></tr>
    </tbody></table></div>)}
    {props.tab === 'history' && <div className="skha-record-table-wrap"><table className="skha-record-table" aria-label="历史成交"><thead><tr><th>成交时间</th><th>平台</th><th>合约</th><th>方向</th><th>成交数量</th><th>成交均价</th><th>策略编号</th><th>成交编号</th></tr></thead><tbody>
      <tr><td>{new Date(props.position?.openedAt ?? 0).toLocaleString()}</td><td>IBKR</td><td><strong>000660</strong></td><td>买入</td><td>{props.position?.remainingEquityQuantity ?? '0'} 股</td><td>{props.position?.equityAverageEntryPrice ?? '—'}</td><td>{props.position?.id ?? '—'}</td><td>FIXTURE-IB</td></tr>
      <tr><td>{new Date(props.position?.openedAt ?? 0).toLocaleString()}</td><td>{props.opportunity.perpVenue}</td><td><strong>{props.opportunity.perpSymbol}</strong></td><td>卖出</td><td>{props.position?.remainingPerpQuantity ?? '0'}</td><td>{props.position?.perpAverageEntryPrice ?? '—'}</td><td>{props.position?.id ?? '—'}</td><td>FIXTURE-PERP</td></tr>
      {props.phase === 'filled' && <><tr><td>刚刚</td><td>IBKR</td><td><strong>000660</strong></td><td>{props.calculation.equitySide}</td><td>{props.calculation.equityShares} 股</td><td>{props.opportunity.equityVwap}</td><td>{props.simulationId}</td><td>SIM-IB</td></tr><tr><td>刚刚</td><td>{props.opportunity.perpVenue}</td><td><strong>{props.opportunity.perpSymbol}</strong></td><td>{props.calculation.perpSide}</td><td>{props.calculation.perpQuantity}</td><td>{props.opportunity.perpVwap}</td><td>{props.simulationId}</td><td>SIM-PERP</td></tr></>}
    </tbody></table></div>}
  </section>;
}
