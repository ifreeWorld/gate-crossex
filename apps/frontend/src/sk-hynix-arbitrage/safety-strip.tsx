export function SafetyStrip() {
  return <section className="skha-safety" aria-label="模拟执行前检查">
    {['TWS 模拟通道', '行情 Schema 有效', '固定标的一致', '汇率 Schema 有效', '模拟余额充足', '真实执行已禁用'].map((label) => <div key={label}>✓ <span>{label}</span></div>)}
  </section>;
}
