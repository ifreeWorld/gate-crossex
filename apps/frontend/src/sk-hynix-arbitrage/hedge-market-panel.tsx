import type { SkHynixArbitrageOpportunity, SkHynixArbitrageSpec } from '@gate-crossex/shared-types';
import type { DemoOrderCalculation } from './demo-model.js';
import { formatSignedBps, formatSignedMoney } from './calculations.js';

interface HedgeMarketPanelProps {
  opportunity: SkHynixArbitrageOpportunity;
  opportunities: SkHynixArbitrageOpportunity[];
  spec: SkHynixArbitrageSpec | null;
  calculation: DemoOrderCalculation;
  mode: 'OPEN' | 'CLOSE';
  onSelectSymbol: (symbol: string) => void;
}

export function HedgeMarketPanel(props: HedgeMarketPanelProps) {
  const item = props.opportunity;
  return <article className="skha-panel skha-market-panel terminal-panel">
    <header><div><p className="eyebrow">固定经济敞口</p><h2>对冲标的</h2></div><small>只显示服务端允许的 SKHYNIX 永续合约</small></header>
    <div className="skha-market-body">
      <div className="skha-instruments">
        <div className="skha-instrument equity"><span>多头 · IBKR <b>TWS</b></span><strong>000660 · SK hynix（KRX）</strong><small>STK · KRW · {props.spec?.equity.exchange ?? 'KRX'}</small></div>
        <i>⇄</i>
        <label className="skha-instrument perp"><span>空头 · 永续 <b>CrossEx</b></span><select aria-label="永续合约" value={item.perpSymbol} disabled={props.mode === 'CLOSE'} onChange={(event) => props.onSelectSymbol(event.target.value)}>{props.opportunities.map((option) => <option value={option.perpSymbol} key={option.perpSymbol}>{option.perpVenue} · {option.perpSymbol}</option>)}</select><small>PERP · USDT · 资金费率 {item.funding.intervalSeconds / 3600} 小时</small></label>
      </div>
      <div className="skha-validation"><b>✓</b><strong>固定标的规范已加载</strong><span>价格按 KRW → USD → USDT 归一化</span><em>1 KRX 股 ↔ 1.000 PERP UNIT</em></div>
      <div className="skha-quotes">
        <div className="head"><span>交易腿</span><span>Bid</span><span>Ask</span><span>更新</span></div>
        <div><strong>IBKR · 000660</strong><span><abbr title={`₩${Number(item.equityQuote.bidKrw).toLocaleString()}`}>{item.equityQuote.bidUsdt}</abbr></span><span><abbr title={`₩${Number(item.equityQuote.askKrw).toLocaleString()}`}>{item.equityQuote.askUsdt}</abbr></span><small>{item.equityQuote.latencyMs} ms</small></div>
        <div><strong>{item.perpVenue} · SKHYNIX</strong><span>{item.perpQuote.bid}</span><span>{item.perpQuote.ask}</span><small>{item.perpQuote.latencyMs} ms</small></div>
      </div>
      <div className="skha-fx-strip">
        <div><span>实时 USD/KRW</span><strong>1 USD = ₩{Number(item.fx.usdKrw).toLocaleString()}</strong><small>固定模拟汇率 · {item.fx.latencyMs} ms</small></div>
        <div><span>股票 Ask（折合 USDT）</span><strong>{item.equityQuote.askUsdt} USDT</strong><small>原价 ₩{Number(item.equityQuote.askKrw).toLocaleString()}</small></div>
        <div><span>USD → USDT</span><strong>1 USDT = {item.fx.usdtUsd} USD</strong><small>当前美元敞口 ${props.calculation.fxExposureUsd}</small></div>
      </div>
    </div>
    <div className="skha-metrics">
      <div><span>{props.mode === 'OPEN' ? '开仓' : '平仓'}可执行价差</span><strong className={Number(props.calculation.executableSpreadBps) >= 0 ? 'positive' : 'negative'}>{formatSignedBps(props.calculation.executableSpreadBps)}</strong><small>{props.mode === 'OPEN' ? '永续 Bid ÷ IBKR Ask（换算后）' : 'IBKR Bid ÷ 永续 Ask（换算后）'}</small></div>
      <div><span>预计累计资金费</span><strong className={Number(item.expectedFundingBps) >= 0 ? 'positive' : 'negative'}>{formatSignedBps(item.expectedFundingBps)}</strong><small>{item.horizonSeconds / 3600} 小时 · 当前费率外推</small></div>
      <div><span>{props.mode === 'OPEN' ? '预计策略净收益' : '当前平仓成本估算'}</span><strong className={Number(props.calculation.expectedNetReturnAmount) >= 0 ? 'positive' : 'negative'}>{formatSignedMoney(props.calculation.expectedNetReturnAmount)}</strong><small>含价差、资金费、费用和示例换汇成本</small></div>
    </div>
  </article>;
}
