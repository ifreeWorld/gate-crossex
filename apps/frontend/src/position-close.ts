import { floorToStep } from './route-shared.js';

/** Scale an absolute position quantity without ever exceeding the requested close percentage. */
export function closeQuantityForPercentage(quantity: string, percentage: number, lotSize: string | null): string {
  const absoluteQuantity = quantity.trim().replace(/^-/, '');
  const numericQuantity = Number(absoluteQuantity);
  if (!Number.isFinite(numericQuantity) || numericQuantity <= 0 || !Number.isFinite(percentage) || percentage <= 0) return '0';
  if (percentage >= 100) return absoluteQuantity;
  return floorToStep((numericQuantity * percentage) / 100, lotSize) || '0';
}
