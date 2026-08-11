import type { SkHynixArbitrageCapabilities } from '@gate-crossex/shared-types';

export function HealthStrip({ capabilities }: { capabilities: SkHynixArbitrageCapabilities | null }) {
  return <section className="skha-health" aria-label="连接状态">
    <div><b>IB</b><span><strong>IBKR · TWS API</strong><small>固定模拟数据 · 未连接 Gateway</small></span><em>{capabilities?.ibkr.marketDataType ?? 'LOADING'}</em></div>
    <div><b>GX</b><span><strong>Gate CrossEx</strong><small>固定模拟行情 · 未使用账户凭据</small></span><em>{capabilities?.perp.connectionState ?? 'LOADING'}</em></div>
    <div><b>⇄</b><span><strong>同步执行器</strong><small>只在浏览器中演示双腿状态变化</small></span><em>SIMULATION</em></div>
  </section>;
}
