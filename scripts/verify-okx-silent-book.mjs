// 只读本地诊断接口；验证 ZHIPU 静默盘口复核，不读取凭证、不下单。
import { writeFileSync } from 'node:fs';
const report = { startedAt: new Date().toISOString(), samples: [], summary: { samples: 0, expired: 0, unavailable: 0, maxSourceAgeMs: 0, restSamples: 0 } };
const seconds = Number(process.env.DIAG_SECONDS ?? 35);
for (let i = 0; i < seconds; i++) {
  const d = await fetch('http://localhost:17840/api/spread-monitor/diagnostics', { signal: AbortSignal.timeout(2000) }).then(r => r.json());
  const s = d.symbols.find(s => s.symbol === 'OKX_FUTURE_ZHIPU_USDT');
  report.samples.push({ at: d.at, ...s });
  const t = report.summary; t.samples++;
  if (!s?.sourceAt) t.unavailable++;
  else {
    const age = d.at - s.sourceAt;
    t.maxSourceAgeMs = Math.max(t.maxSourceAgeMs, age);
    t.expired += Number(age > 5000);
    t.restSamples += Number(s.source === 'venue_public_rest');
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
writeFileSync('docs/okx-zhipu-rest-priority-verification.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary));
process.exitCode = report.summary.expired || report.summary.unavailable || !report.summary.restSamples ? 1 : 0;
