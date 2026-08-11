import type { SkHynixArbitrageOpportunity } from '@gate-crossex/shared-types';
import { formatSignedBps, formatSignedMoney } from './calculations.js';

interface OpportunityTableProps {
  opportunities: SkHynixArbitrageOpportunity[];
  selectedSymbol: string | null;
  onSelect: (opportunity: SkHynixArbitrageOpportunity) => void;
}

export function OpportunityTable({ opportunities, selectedSymbol, onSelect }: OpportunityTableProps) {
  return <div className="skha-table-wrap">
    <table className="skha-table">
      <thead><tr><th>交易所</th><th>永续合约</th><th>资金费率 / 周期</th><th>IBKR 买入 VWAP</th><th>永续卖出 VWAP</th><th>开仓价差</th><th>预计策略收益</th><th>操作</th></tr></thead>
      <tbody>{opportunities.map((item, index) => <tr key={item.perpSymbol} className={selectedSymbol === item.perpSymbol ? 'selected' : ''}>
        <td><span className="skha-rank-number">{index + 1}</span><strong>{item.perpVenue}</strong></td>
        <td>{item.perpSymbol}</td>
        <td><strong className={Number(item.funding.rate) >= 0 ? 'positive' : 'negative'}>{formatSignedBps(String(Number(item.funding.rate) * 10_000))}</strong><small>每 {item.funding.intervalSeconds / 3600} 小时 · 当前费率外推</small></td>
        <td><abbr title={`₩${Number(item.equityQuote.askKrw).toLocaleString()}，按示例汇率折算`}>{item.equityQuote.askUsdt} USDT</abbr></td>
        <td>{item.perpQuote.bid} USDT</td>
        <td className={Number(item.openingSpreadBps) >= 0 ? 'positive' : 'negative'}>{formatSignedBps(item.openingSpreadBps)}</td>
        <td><strong className={Number(item.expectedNetReturnBps) >= 0 ? 'positive' : 'negative'}>{formatSignedBps(item.expectedNetReturnBps)}</strong><small>{formatSignedMoney(item.expectedNetReturnAmount)} · 非保证收益</small></td>
        <td><button type="button" className="skha-select" aria-pressed={selectedSymbol === item.perpSymbol} onClick={() => onSelect(item)}>{selectedSymbol === item.perpSymbol ? '已选' : '选中'}</button></td>
      </tr>)}</tbody>
    </table>
  </div>;
}
