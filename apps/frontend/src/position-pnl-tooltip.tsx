import type { ReactNode } from 'react';
import { FundingRateTooltip } from './funding-rate-tooltip.js';
import { useLanguage } from './i18n.js';
import { netPositionPnl } from './position-funding-fees.js';
import { signedAmount } from './route-shared.js';

interface PositionPnlTooltipProps {
  pricePnl: number;
  fundingFee: number | null;
  tradingFee: number | null;
  quote: string;
  className?: string;
  children?: ReactNode;
}

function componentAmount(value: number | null, quote: string, invert = false): string {
  if (value === null) return '—';
  return `${signedAmount(invert ? -value : value, 4)} ${quote}`;
}

/** Compact table heading with the accounting definition available on hover or keyboard focus. */
export function PositionPnlHeader() {
  const { t } = useLanguage();
  const explanation = [
    t('Includes settled funding and trading fees already charged to the position.'),
    t('Formula: price PnL + settled funding - trading fees paid.'),
    t('Future closing fees are not included.'),
  ].join('\n');

  return <span className="position-pnl-heading">
    <span>{t('Position PnL')}</span>
    <FundingRateTooltip className="position-pnl-help" text={explanation}>
      <span aria-label={t('Position PnL calculation')}>?</span>
    </FundingRateTooltip>
  </span>;
}

/** A shared net-PnL value so trading and strategy tables always show the same accounting. */
export function PositionPnlTooltip({
  pricePnl,
  fundingFee,
  tradingFee,
  quote,
  className,
  children,
}: PositionPnlTooltipProps) {
  const { t } = useLanguage();
  const netPnl = netPositionPnl(pricePnl, fundingFee, tradingFee);
  const hasUnavailableComponent = fundingFee === null || tradingFee === null;
  const lines = [
    `${t('Net position PnL')}: ${signedAmount(netPnl, 4)} ${quote}`,
    `${t('Price PnL')}: ${signedAmount(pricePnl, 4)} ${quote}`,
    `${t('Settled funding')}: ${componentAmount(fundingFee, quote)}`,
    `${t('Trading fees paid')}: ${componentAmount(tradingFee, quote, true)}`,
    t('Formula: price PnL + settled funding - trading fees paid.'),
    t('Future closing fees are not included.'),
    ...(hasUnavailableComponent ? [t('Unavailable components are treated as zero in the displayed total.')] : []),
  ];

  return <FundingRateTooltip
    className={`${className ?? ''} funding-rate-hover`.trim()}
    text={lines.join('\n')}
  >{children ?? `${signedAmount(netPnl)} ${quote}`}</FundingRateTooltip>;
}
