import { afterEach, expect, it, vi } from 'vitest';
import { barkConfigured, sendSpreadBark } from './spread-bark.js';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('未配置不发送，凭证仅放在请求体', async () => {
  vi.stubEnv('BARK_DEVICE_KEY', '');
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect(barkConfigured()).toBe(false);
  expect(await sendSpreadBark('标题', '内容')).toBe('failed');
  expect(fetcher).not.toHaveBeenCalled();
  vi.stubEnv('BARK_DEVICE_KEY', 'test-only-key'); vi.stubEnv('BARK_SERVER_URL', 'https://bark.example.test');
  fetcher.mockResolvedValue(new Response(JSON.stringify({ code: 200 }), { status: 200 }));
  expect(await sendSpreadBark('标题', '内容')).toBe('sent');
  expect(String(fetcher.mock.calls[0][0])).toBe('https://bark.example.test/push');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ device_key: 'test-only-key', title: '标题', body: '内容' });
  expect(fetcher.mock.calls[0][1].redirect).toBe('error');
});
it('超时结果未知，服务端拒绝为失败，均不自动重试', async () => {
  vi.stubEnv('BARK_DEVICE_KEY', 'test-only-key');
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(new Response(JSON.stringify({ code: 400 }), { status: 400 }));
  vi.stubGlobal('fetch', fetcher);
  expect(await sendSpreadBark('标题', '内容')).toBe('unknown');
  expect(await sendSpreadBark('标题', '内容')).toBe('failed');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
