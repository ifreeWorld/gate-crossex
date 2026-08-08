import { useEffect, useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface FundingRateTooltipProps {
  text: string;
  className?: string;
  children: ReactNode;
}

interface TooltipPosition {
  left: number;
  top: number;
  below: boolean;
}

const TOOLTIP_WIDTH = 320;
const VIEWPORT_GUTTER = 12;

export function FundingRateTooltip({ text, className, children }: FundingRateTooltipProps) {
  const tooltipId = useId();
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const show = (target: HTMLElement) => {
    const bounds = target.getBoundingClientRect();
    const left = Math.min(
      window.innerWidth - TOOLTIP_WIDTH - VIEWPORT_GUTTER,
      Math.max(VIEWPORT_GUTTER, bounds.left + bounds.width / 2 - TOOLTIP_WIDTH / 2),
    );
    const below = bounds.top < 110;
    setPosition({ left, top: below ? bounds.bottom + 9 : bounds.top - 9, below });
  };

  useEffect(() => {
    if (!position) return;
    const hide = () => setPosition(null);
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('resize', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [position]);

  const [amountLine = '', directionLine = '', ...noteLines] = text.split('\n');
  return <>
    <span
      className={className}
      tabIndex={0}
      aria-describedby={position ? tooltipId : undefined}
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={() => setPosition(null)}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={() => setPosition(null)}
    >{children}</span>
    {position && createPortal(
      <span
        id={tooltipId}
        role="tooltip"
        className={`funding-rate-tooltip${position.below ? ' below' : ''}`}
        style={{ left: position.left, top: position.top }}
      >
        <strong>{amountLine}</strong>
        <span>{directionLine}</span>
        <small>{noteLines.join('\n')}</small>
      </span>,
      document.body,
    )}
  </>;
}
