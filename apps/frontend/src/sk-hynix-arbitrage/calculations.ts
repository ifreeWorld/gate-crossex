function signed(value: number): string {
  return value >= 0 ? '+' : '';
}

export function formatSignedBps(value: string): string {
  const numeric = Number(value);
  return `${signed(numeric)}${numeric.toFixed(2)} bps`;
}

export function formatSignedMoney(value: string, currencySymbol = '$'): string {
  const numeric = Number(value);
  const sign = numeric >= 0 ? '+' : '-';
  return `${sign}${currencySymbol}${Math.abs(numeric).toFixed(2)}`;
}
