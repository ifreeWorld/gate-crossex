const PREMIUM_PAIR_ASSETS = new Set(['SKHY', 'SKHYNIX']);

/** SKHY (ADR) and SKHYNIX (local listing) form one premium-strategy position group. */
export function positionGroupKey(asset: string): string {
  return PREMIUM_PAIR_ASSETS.has(asset) ? 'SKHY-SKHYNIX' : asset;
}

export function positionGroupLabel(assets: readonly string[]): string {
  const uniqueAssets = new Set(assets);
  return uniqueAssets.has('SKHY') && uniqueAssets.has('SKHYNIX')
    ? 'SKHY / SKHYNIX'
    : assets[0] ?? '';
}
