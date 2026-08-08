# Premium strategy position lifecycle

## Stopping an active strategy

Stopping a premium strategy stops its automation and cancels locally tracked open orders. It does
not close positions that the strategy already opened. A stopped strategy cannot receive a new
take-profit level, so an existing position currently requires either manual closing or a separate
reduce-only strategy.

## Original strategy take profit

An uninterrupted equal-notional premium strategy records the actual fills of both entry legs in
its strategy ledger. When take profit triggers, the hedge-leg close quantity is calculated from the
actual remaining filled ratio:

```text
hedge close quantity = ADR close quantity × remaining hedge shares / remaining ADR shares
```

Every exit order is reduce-only. After the first exit attempt, the strategy uses its own persisted
fill ledger to submit additional reduce-only orders for residual exposure until both strategy legs
are flat or bounded recovery attempts fail. This covers partial fills and one-leg submission
failures. It covers only exposure opened by that strategy; unrelated or manually changed positions
on the same symbols are outside its ledger.

## Attaching a new reduce-only strategy

A newly created reduce-only strategy reads the current positions shown by the account snapshot and
defaults to closing both exact quantities. The ADR-leg amount remains the strategy's target, while
the hedge-leg amount is persisted separately as `hedgeCloseQuantity`. The backend then validates
both configured totals against a fresh exchange position snapshot before saving the strategy.

Later price changes do not alter either configured close total. For multiple clips, regular hedge
orders are rounded down to the exchange lot size and the final clip receives the exact remaining
hedge quantity. This prevents price drift and per-clip rounding from leaving a hedge-leg remainder.

Both orders are submitted with `reduce_only=true`. A one-leg failure uses the same per-clip requested
ratio for bounded repair attempts. Strategy completion means that the two explicitly configured
close totals were executed and balanced in the strategy ledger. If the user enters less than the
full live positions, the unselected remainder intentionally stays open.

Example: an existing short `8.3 SKHY` and long `1.12 SKHYNIX` is configured as exactly `8.3 / 1.12`.
With `3 SKHY` clips and a `0.01 SKHYNIX` lot size, the hedge orders are `0.40`, `0.40`, and `0.32`,
so the total remains exactly `1.12` instead of accumulating rounding dust.

## Safety boundary

The launch preflight is authoritative at the time the strategy is created, but positions can still
be changed manually or by another strategy before the trigger arrives. Exchange-side reduce-only
protection prevents an order from increasing or reversing a position; such a changed position can
therefore cause a later leg rejection and pause the strategy for review. Check both live positions
after any partial fill, external trade, or execution warning.
