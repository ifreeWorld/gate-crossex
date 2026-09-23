export function barkConfigured() { return Boolean(process.env.BARK_DEVICE_KEY?.trim()); }
// 不将凭证、请求 URL 或上游响应写入日志。
export async function sendSpreadBark(title: string, body: string, group = '永续价差监控'): Promise<'sent' | 'failed' | 'unknown'> {
  if (!barkConfigured()) return 'failed';
  try {
    const base = new URL('/push', process.env.BARK_SERVER_URL || 'https://api.day.app');
    if (!['https:', 'http:'].includes(base.protocol)) return 'failed';
    const response = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_key: process.env.BARK_DEVICE_KEY, title, body, group }), signal: AbortSignal.timeout(10000), redirect: 'error' });
    const payload = await response.json() as { code?: number };
    return response.ok && payload.code === 200 ? 'sent' : 'failed';
  } catch { return 'unknown'; }
}
