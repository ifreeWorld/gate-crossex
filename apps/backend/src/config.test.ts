import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('backend configuration', () => {
  it('keeps Host validation enabled for the default loopback listener', () => {
    const config = loadConfig({});

    expect(config.host).toBe('127.0.0.1');
    expect(config.allowAnyHost).toBe(false);
  });

  it.each(['0.0.0.0', '::'])('accepts any Host when explicitly listening on %s', (host) => {
    const config = loadConfig({ GCT_HOST: host });

    expect(config.host).toBe(host);
    expect(config.allowAnyHost).toBe(true);
  });
});
