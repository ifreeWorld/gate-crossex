import { z } from 'zod';

const REFRESH_MS = 10 * 60_000;
const MAX_AGE_MS = 30 * 60_000;
const RETRY_MS = 60_000;
const CoinSchema = z.object({ id: z.string(), symbol: z.string(), total_volume: z.number().finite().nonnegative().nullable().optional(), market_cap: z.number().finite().nonnegative().nullable(), last_updated: z.string().nullable() });
// 明确身份的常见标的；其余只接受唯一 symbol，绝不直接取同名币的最大市值。
const COIN_IDS: Record<string, string> = {
  USDT: 'tether', USDC: 'usd-coin', DAI: 'dai', USDE: 'ethena-usde', FDUSD: 'first-digital-usd',
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin', XRP: 'ripple',
  DOGE: 'dogecoin', ADA: 'cardano', TRX: 'tron', AVAX: 'avalanche-2', LINK: 'chainlink',
  DOT: 'polkadot', LTC: 'litecoin', BCH: 'bitcoin-cash', SUI: 'sui', TON: 'the-open-network',
};

export interface SpreadMarketCapSource {
  refresh(assets: string[]): Promise<void>;
  get(asset: string): number | null;
  getStats?(asset: string): { marketCapUsd: number | null; volume24hUsd: number | null; updatedAt: number } | null;
  readonly error: string | null;
  stop(): void;
}

/** 低频拉取流通市值，按资产缓存；接口失败不能使未知市值通过筛选。 */
export class SpreadMarketCaps implements SpreadMarketCapSource {
  private entries = new Map<string, { value: number | null; volume: number | null; fetchedAt: number; sourceAt: number }>();
  private retryAt = 0;
  private pending: Promise<void> | null = null;
  private controller = new AbortController();
  error: string | null = null;
  constructor(private options: { now?: () => number; fetch?: typeof fetch; apiKey?: string } = {}) {}
  private now() { return this.options.now?.() ?? Date.now(); }
  get(asset: string): number | null {
    return this.getStats(asset)?.marketCapUsd ?? null;
  }
  getStats(asset: string) {
    const entry = this.entries.get(asset.toUpperCase());
    return entry && this.now() - entry.fetchedAt <= MAX_AGE_MS && this.now() - entry.sourceAt <= MAX_AGE_MS && entry.sourceAt > 0
      ? { marketCapUsd: entry.value, volume24hUsd: entry.volume, updatedAt: entry.sourceAt } : null;
  }
  refresh(assets: string[]): Promise<void> {
    if (this.controller.signal.aborted || this.now() < this.retryAt) return Promise.resolve();
    if (this.pending) return this.pending;
    const needed = [...new Set(assets.map(asset => asset.toUpperCase()))].filter(asset => {
      const entry = this.entries.get(asset);
      return !entry || this.now() - entry.fetchedAt >= REFRESH_MS;
    });
    if (!needed.length) return Promise.resolve();
    this.pending = this.load(needed).catch(() => {
      this.error = '流通市值加载失败，正在重试；超过 30 分钟的数据按未知处理';
      this.retryAt = this.now() + RETRY_MS;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  private async load(assets: string[]) {
    for (let offset = 0; offset < assets.length; offset += 50) {
      const batch = assets.slice(offset, offset + 50);
      const coins = new Map<string, z.infer<typeof CoinSchema>>();
      for (let page = 1; ; page++) {
        // 分页未完整获取时不发布部分结果，避免把同名币误判为唯一匹配。
        if (page > 20) throw new Error('market_cap_pagination_limit');
        const url = new URL('https://api.coingecko.com/api/v3/coins/markets');
        url.search = new URLSearchParams({ vs_currency: 'usd', symbols: batch.join(',').toLowerCase(), include_tokens: 'all', per_page: '250', page: String(page) }).toString();
        const key = this.options.apiKey ?? process.env.COINGECKO_DEMO_API_KEY;
        const response = await (this.options.fetch ?? fetch)(url, {
          headers: key ? { 'x-cg-demo-api-key': key } : {},
          signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000)]),
        });
        if (!response.ok) throw new Error('market_cap_unavailable');
        const data = z.array(CoinSchema).parse(await response.json());
        for (const coin of data) coins.set(coin.id, coin);
        if (data.length < 250) break;
      }
      for (const asset of batch) {
        const matches = [...coins.values()].filter(coin => coin.symbol.toUpperCase() === asset);
        const coin = COIN_IDS[asset] ? matches.find(coin => coin.id === COIN_IDS[asset]) : matches.length === 1 ? matches[0] : undefined;
        const sourceAt = coin?.last_updated ? Date.parse(coin.last_updated) : NaN;
        const valid = Number.isFinite(sourceAt) && sourceAt <= this.now() + 60000;
        this.entries.set(asset, { value: valid ? coin?.market_cap ?? null : null, volume: valid ? coin?.total_volume ?? null : null, sourceAt: valid ? sourceAt : 0, fetchedAt: this.now() });
      }
    }
    this.error = null;
  }
  stop() { this.controller.abort(); }
}
