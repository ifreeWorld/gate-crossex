import { useMemo, useState, type CSSProperties } from 'react';
import {
  api,
  ApiError,
  type AuthenticatedPortfolioSnapshot,
  type CrossExInstrument,
  type StrategyConfig,
} from './api.js';
import { useLanguage } from './i18n.js';
import { marketSymbol } from './market-symbol.js';
import { closeQuantityForPercentage } from './position-close.js';
import { positionGroupLabel } from './position-grouping.js';
import { formatAmount, symbolParts, useDialogFocus } from './route-shared.js';

export interface ClosePositionTarget {
  id: string;
  positionId: string;
  symbol: string;
  quantity: string;
  markPrice: string;
}

interface PositionCloseDialogProps {
  targets: ClosePositionTarget[];
  portfolio: AuthenticatedPortfolioSnapshot | null;
  instruments: CrossExInstrument[] | null;
  onDismiss: () => void;
  onCompleted: () => Promise<void> | void;
  notify: (kind: 'ok' | 'error', title: string, text: string) => void;
}

export function PositionCloseDialog({ targets, portfolio, instruments, onDismiss, onCompleted, notify }: PositionCloseDialogProps) {
  const { t } = useLanguage();
  const [selectedIds, setSelectedIds] = useState<string[]>(() => targets.map((target) => target.id));
  const [closePercentage, setClosePercentage] = useState(100);
  const [splitClose, setSplitClose] = useState(false);
  const [closeOrderCount, setCloseOrderCount] = useState('4');
  const [closeIntervalSeconds, setCloseIntervalSeconds] = useState('5');
  const [closing, setClosing] = useState(false);
  const dialogRef = useDialogFocus(true, closing ? undefined : onDismiss);

  const selectable = targets.length > 2;
  const selectedTargets = selectable ? targets.filter((target) => selectedIds.includes(target.id)) : targets;
  const closeAssets = [...new Set(targets.map((target) => symbolParts(target.symbol).asset))];
  const closeAssetLabel = positionGroupLabel(closeAssets);
  const venueCount = new Set(targets.map((target) => symbolParts(target.symbol).venue)).size;
  const selectedAssets = [...new Set(selectedTargets.map((target) => symbolParts(target.symbol).asset))];
  const quantityByTarget = useMemo(() => new Map(selectedTargets.map((target) => {
    const lotSize = instruments?.find((instrument) => instrument.symbol === target.symbol)?.lotSize ?? null;
    return [target.id, closeQuantityForPercentage(target.quantity, closePercentage, lotSize)] as const;
  })), [selectedTargets, instruments, closePercentage]);
  const percentageValid = closePercentage > 0 && selectedTargets.length > 0
    && selectedTargets.every((target) => Number(quantityByTarget.get(target.id)) > 0);
  const closeSize = selectedTargets.length > 0 && selectedAssets.length > 1
    ? selectedTargets.map((target) => `${formatAmount(Number(quantityByTarget.get(target.id) ?? 0), 4)} ${symbolParts(target.symbol).asset}`).join(' / ')
    : selectedTargets.length > 0
      ? `${formatAmount(selectedTargets.reduce((sum, target) => sum + Number(quantityByTarget.get(target.id) ?? 0), 0), 4)} ${selectedAssets[0] ?? ''}`
      : '—';
  const splitOrderCount = Number(closeOrderCount);
  const splitInterval = Number(closeIntervalSeconds);
  const splitValid = Number.isInteger(splitOrderCount) && splitOrderCount >= 2 && splitOrderCount <= 100
    && Number.isInteger(splitInterval) && splitInterval >= 1 && splitInterval <= 86_400;

  async function refreshAfterClose() {
    try {
      await onCompleted();
    } catch {
      // Live execution and strategy streams will still reconcile accepted close requests.
    }
  }

  async function closePositions() {
    if (closing || !percentageValid || (splitClose && !splitValid)) return;
    setClosing(true);
    const positionMode = portfolio?.snapshot.account.positionMode;
    if (splitClose) {
      const closePlanTargets = selectedTargets.map((target) => {
        const portfolioPosition = portfolio?.snapshot.futuresPositions?.find((item) => item.positionId === target.positionId || item.symbol === target.symbol);
        const signedQuantity = Number(target.quantity);
        const inferredSide = signedQuantity >= 0 ? 'LONG' : 'SHORT';
        const positionSide: 'NONE' | 'LONG' | 'SHORT' = positionMode === 'DUAL'
          ? (portfolioPosition?.positionSide === 'LONG' || portfolioPosition?.positionSide === 'SHORT' ? portfolioPosition.positionSide : inferredSide)
          : 'NONE';
        return {
          symbol: target.symbol,
          side: (signedQuantity >= 0 ? 'SELL' : 'BUY') as 'BUY' | 'SELL',
          quantity: quantityByTarget.get(target.id) ?? '0',
          positionSide,
        };
      });
      const first = closePlanTargets[0];
      const second = closePlanTargets[1] ?? first;
      const firstPart = symbolParts(first.symbol);
      const config: StrategyConfig = {
        kind: 'position',
        asset: firstPart.asset,
        leftVenue: firstPart.venue,
        rightVenue: symbolParts(second.symbol).venue,
        leftSide: first.side,
        rightSide: first.side === 'BUY' ? 'SELL' : 'BUY',
        totalAmount: first.quantity,
        perOrderQuantity: first.quantity,
        reduceOnly: true,
        executionMethod: 'TAKER_TAKER',
        closePlan: { orderCount: splitOrderCount, intervalSeconds: splitInterval, targets: closePlanTargets },
      };
      try {
        const strategy = await api.startStrategy(config);
        notify('ok', t('Close strategy started'), `${strategy.id} · ${splitOrderCount} ${t('orders')} · ${splitInterval}s`);
        await refreshAfterClose();
        onDismiss();
      } catch (error) {
        notify('error', t('Position close failed'), error instanceof ApiError ? error.message : t('Backend unavailable'));
      } finally {
        setClosing(false);
      }
      return;
    }

    const results = await Promise.allSettled(selectedTargets.map((target) => {
      const portfolioPosition = portfolio?.snapshot.futuresPositions?.find((item) => item.positionId === target.positionId || item.symbol === target.symbol);
      const signedQuantity = Number(target.quantity);
      const inferredSide = signedQuantity >= 0 ? 'LONG' : 'SHORT';
      const positionSide = positionMode === 'DUAL'
        ? (portfolioPosition?.positionSide === 'LONG' || portfolioPosition?.positionSide === 'SHORT' ? portfolioPosition.positionSide : inferredSide)
        : 'NONE';
      return api.createOrder({
        symbol: target.symbol,
        side: signedQuantity >= 0 ? 'SELL' : 'BUY',
        type: 'MARKET',
        timeInForce: 'IOC',
        quantity: quantityByTarget.get(target.id) ?? '0',
        reduceOnly: true,
        positionSide,
      });
    }));
    const failures = results.filter((result) => result.status === 'rejected');
    await refreshAfterClose();
    if (failures.length === 0) {
      notify('ok', t('Close order submitted'), `${selectedTargets.length} · ${t('Market reduce-only')}`);
    } else {
      const firstFailure = failures[0] as PromiseRejectedResult;
      const detail = firstFailure.reason instanceof ApiError ? firstFailure.reason.message : t('Backend unavailable');
      notify('error', t(failures.length === selectedTargets.length ? 'Position close failed' : 'Some positions failed to close'), detail);
    }
    setClosing(false);
    onDismiss();
  }

  return <div className="modal-backdrop confirm-order-backdrop" role="presentation" onMouseDown={() => { if (!closing) onDismiss(); }}>
    <section ref={dialogRef} tabIndex={-1} className="confirm-order-modal close-position-modal" role="dialog" aria-modal="true" aria-labelledby="close-position-title" onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div><p className="eyebrow negative">{t('Close position')}</p><h2 id="close-position-title">{t('Confirm close position')}</h2><span className="confirm-market">{targets.length === 1 ? marketSymbol(symbolParts(targets[0].symbol).asset, symbolParts(targets[0].symbol).quote, 'perpetual') : `${closeAssetLabel} PERP`} · {venueCount} {t(venueCount === 1 ? 'exchange' : 'exchanges')}</span></div>
        <button className="disclaimer-close" aria-label={t('Close')} onClick={onDismiss} disabled={closing}>×</button>
      </header>
      <dl className="confirm-order-summary">
        <div><dt>{t('Positions to close')}</dt><dd>{selectedTargets.length}</dd></div>
        <div><dt>{t('Size')}</dt><dd>{closeSize}</dd></div>
        <div><dt>{t('Position notional')}</dt><dd>${formatAmount(selectedTargets.reduce((sum, target) => sum + Number(quantityByTarget.get(target.id) ?? 0) * Number(target.markPrice), 0))}</dd></div>
        <div><dt>{t('Execution')}</dt><dd>{t('Market reduce-only')}</dd></div>
      </dl>
      {selectable && <div className="close-position-selector">
        <div className="close-position-selector-head">
          <strong>{t('Select positions to close')}</strong><span>{selectedTargets.length} / {targets.length}</span>
          <button type="button" onClick={() => setSelectedIds(targets.map((target) => target.id))} disabled={closing || selectedTargets.length === targets.length}>{t(selectedTargets.length === targets.length ? 'All selected' : 'Select all')}</button>
        </div>
        <div className="close-position-options">{targets.map((target) => {
          const part = symbolParts(target.symbol);
          const selected = selectedIds.includes(target.id);
          const long = Number(target.quantity) >= 0;
          return <label className={selected ? 'close-position-option selected' : 'close-position-option'} key={target.id}>
            <input type="checkbox" checked={selected} onChange={() => setSelectedIds((current) => selected ? current.filter((id) => id !== target.id) : [...current, target.id])} disabled={closing} />
            <span><strong>{marketSymbol(part.asset, part.quote, 'perpetual')}</strong><small>{part.venue} · {t(long ? 'Long' : 'Short')}</small></span>
            <b>{formatAmount(Math.abs(Number(target.quantity)), 4)} {part.asset}</b>
          </label>;
        })}</div>
        {selectedTargets.length === 0 && <p>{t('Choose at least one position to close.')}</p>}
      </div>}
      <div className="close-percentage-control">
        <div><strong>{t('Close amount')}</strong><b>{closePercentage}%</b></div>
        <input type="range" min="0" max="100" step="1" value={closePercentage} onChange={(event) => setClosePercentage(Number(event.target.value))} disabled={closing} aria-label={t('Close amount')} style={{ '--close-percentage': `${closePercentage}%` } as CSSProperties} />
        <div className="close-percentage-marks"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
        {selectedTargets.length > 0 && !percentageValid && <p>{t(closePercentage === 0 ? 'Choose a close amount above 0%.' : 'Close amount is below the minimum order size for at least one position.')}</p>}
      </div>
      <label className="split-close-toggle"><input type="checkbox" checked={splitClose} onChange={(event) => setSplitClose(event.target.checked)} disabled={closing} /><span><strong>{t('Split into multiple orders')}</strong><small>{t('Run the close as a timed reduce-only hedge position strategy.')}</small></span></label>
      {splitClose && <div className="split-close-fields">
        <label><span>{t('Number of orders')}</span><input type="number" inputMode="numeric" min="2" max="100" step="1" value={closeOrderCount} onChange={(event) => setCloseOrderCount(event.target.value)} disabled={closing} /></label>
        <label><span>{t('Time gap between orders')}</span><div><input type="number" inputMode="numeric" min="1" max="86400" step="1" value={closeIntervalSeconds} onChange={(event) => setCloseIntervalSeconds(event.target.value)} disabled={closing} /><b>{t('seconds')}</b></div></label>
      </div>}
      <p className="close-position-warning">{t(splitClose ? 'Split close warning' : 'Close position warning')}</p>
      <div className="confirm-order-actions">
        <button className="confirm-back" data-dialog-autofocus onClick={onDismiss} disabled={closing}>{t('Go back')}</button>
        <button className="confirm-submit sell" onClick={() => void closePositions()} disabled={closing || !percentageValid || (splitClose && !splitValid)}><strong>{closing ? t(splitClose ? 'Starting close strategy…' : 'Closing position…') : t('Confirm close')}</strong><span>{splitClose ? `${closeOrderCount || '—'} ${t('orders')} · ${closeIntervalSeconds || '—'}s · ${closePercentage}%` : `${t('Market reduce-only')} · ${closePercentage}%`}</span></button>
      </div>
    </section>
  </div>;
}
