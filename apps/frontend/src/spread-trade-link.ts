/** 优先使用简体中文交易路径；Hyperliquid/Kraken Pro 保留站内语言偏好。 */
export function spreadTradeLink(symbol: string, nativeMarket?: string): string | null {
  const [venue, product, base, quote] = symbol.split('_');
  if (product !== 'FUTURE' || !base || !quote) return null;
  const encode = encodeURIComponent;
  switch (venue) {
    case 'GATE': return `https://www.gate.com/zh/futures/${encode(quote)}/${encode(`${base}_${quote}`)}`;
    case 'BINANCE': return `https://www.binance.com/zh-CN/futures/${encode(`${base}${quote}`)}`;
    case 'OKX': return `https://www.okx.com/zh-hans/trade-swap/${encode(`${base}-${quote}-swap`.toLowerCase())}`;
    case 'BYBIT': return quote === 'USDC' ? `https://www.bybit.com/zh-CN/trade/usdc/${encode(`${base}PERP`)}` : `https://www.bybit.com/zh-CN/trade/usdt/${encode(`${base}${quote}`)}`;
    case 'HYPERLIQUID': return nativeMarket ? `https://app.hyperliquid.xyz/trade/${encode(nativeMarket)}` : 'https://app.hyperliquid.xyz/trade';
    case 'KRAKEN': return `https://pro.kraken.com/app/trade/${encode(`${base}-${quote}-perp`.toLowerCase())}`;
    default: return null;
  }
}
