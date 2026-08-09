# SK Hynix Funding Carry Strategy Design

Date: 2026-08-09

## 1. Decision

Add a new `sk_hynix_carry` strategy alongside the existing `premium` strategy.

- Existing route: `/strategies/sk-hynix-premium`
- New route: `/strategies/sk-hynix-funding`
- Existing `premium` behavior and persisted records remain unchanged.
- The first implementation milestone is read-only. It must not connect a real IBKR or exchange trading account and must not expose an enabled order button.
- Real execution requires a later, explicit approval after read-only market data, simulations, recovery, and compensation behavior have been verified.

The standalone prototype at `docs/sk-hynix-tws-strategy-demo.html` is a design reference, not production code. It remains in the repository working tree until the user decides whether to track it.

## 2. Strategy definition

Opening direction:

- Buy the verified SK Hynix equity instrument through IBKR.
- Short the verified economically equivalent perpetual contract through a supported crypto venue.

Closing direction:

- Sell only equity quantity owned by this strategy.
- Buy only perpetual quantity shorted by this strategy, with exchange-side reduce-only protection.

The application must not infer equivalence from similar ticker names. A pair is eligible only when a stored instrument mapping is `VERIFIED` and contains the exact IBKR contract, perpetual contract, economic conversion ratio, currencies, and verification metadata.

## 3. Scope

### Included

- A separate React route and strategy menu entry.
- Opportunity ranking, selected-pair detail, order preview, execution-lane presentation, and strategy-position presentation.
- Open preview sized from a target notional.
- Close preview sized from the strategy's actual positions, defaulting to 100% and supporting 25%, 50%, 75%, and 100%.
- Decimal-safe VWAP, FX normalization, hedge sizing, and estimated-return calculations.
- Explicit quote freshness, live/delayed state, market-hours state, funding interval, and estimate assumptions.
- A read-only API boundary that can later accept IBKR, exchange, and FX adapters.
- A separate simulated dual-leg coordinator before any live coordinator is introduced.
- A persisted live execution design with recovery, compensation, and manual-intervention states for the later live milestone.

### Excluded from the first milestone

- Real IBKR login, market-data subscription, or order submission.
- Real exchange order submission.
- Automatic installation or operation of TWS, IB Gateway, or IBC.
- Treating the prototype's sample contracts, conversion ratios, prices, or funding periods as verified business data.
- Modifying the existing CrossEx `premium` strategy.

## 4. Existing-system constraints

The repository is a local single-user React/Vite and Fastify application. API values use runtime schemas and decimal strings. The browser talks only to the local backend.

The current trading runtime cannot be extended by merely adding `IBKR` to its venue enum:

- It accepts only crypto venue identifiers.
- Its order symbols must match a perpetual-futures naming pattern.
- Both legs use the same CrossEx gateway, balance model, and private event stream.
- The existing `premium` strategy assumes two crypto derivative legs.

The new strategy therefore gets an independent domain model and coordinator. It may reuse infrastructure such as SQLite, local HTTP/WebSocket delivery, trading-session locks, logging conventions, decimal handling, and UI primitives, but not the existing strategy's order contract.

## 5. Frontend design

### 5.1 File boundaries

Create a focused feature directory instead of growing `strategy-route.tsx`:

```text
apps/frontend/src/sk-hynix-carry/
  route.tsx
  opportunity-table.tsx
  instrument-pair.tsx
  order-ticket.tsx
  execution-lanes.tsx
  positions-panel.tsx
  calculations.ts
  calculations.test.ts
  close-sizing.ts
  close-sizing.test.ts
```

`route.tsx` composes the feature and owns only page-level selection and presentation state. Calculation files contain deterministic view helpers, not authoritative trading calculations.

Add the internal key `carry` to `StrategyRouteKind` and map it to `/strategies/sk-hynix-funding`. Add the corresponding lazy import and strategy-menu entry. Keep the route independent from `PremiumStrategyView`.

### 5.2 Page hierarchy

Preserve the prototype's strongest hierarchy:

1. Connection and eligibility summary.
2. Opportunity ranking for a requested notional and holding horizon.
3. Verified instrument mapping, quotes, FX normalization, and estimate assumptions.
4. Open/close ticket with quantity preview and residual exposure.
5. Dual-leg execution lanes.
6. Strategy-scoped positions, orders, fills, funding, costs, and PnL.

Reuse the application's theme, localization, `terminal-panel` visual language, accessibility conventions, and lazy route loading. Do not embed the prototype in an iframe and do not copy its global CSS.

### 5.3 Read-only behavior

The first milestone uses validated fixture responses served through the same frontend API boundary planned for live read-only data.

- Label all values as example data.
- Display connection state as `READ_ONLY_FIXTURE`.
- Render the submit button disabled with the label `Read-only preview`.
- Do not show `Paper trading`, because the current application has no paper execution ledger.
- An unverified mapping, stale quote, delayed IBKR quote, closed equity market, missing depth, or missing FX quote makes the opportunity ineligible.

### 5.4 Open and close sizing

Open sizing begins with target quote-currency notional:

1. Convert the IBKR executable equity price to the strategy reporting currency.
2. Round the equity quantity down to its permitted lot size; initially this is an integer-share rule unless verified contract metadata says otherwise.
3. Convert the resulting equity economic exposure through the verified mapping.
4. Round the perpetual quantity down to the venue step size without exceeding the equity exposure.
5. Display residual economic and currency exposure.

Close sizing begins with the strategy ledger, never a new notional input:

1. Read remaining IBKR shares and remaining perpetual quantity for the selected strategy.
2. Default to 100%.
3. Convert a percentage to an executable equity quantity.
4. Derive the proportional perpetual quantity from the strategy's actual remaining fill ratio.
5. Round within venue constraints and assign the final full-close operation the exact remaining executable amount.
6. Reject quantities above the strategy-owned position.
7. Display both remaining positions and remaining net exposure.

## 6. Shared contracts

Add new schemas to `packages/shared-types` without changing the existing `StrategyConfigSchema` in the first milestone.

### 6.1 Instrument mapping

```text
CarryInstrumentMapping
  mappingId
  status: UNVERIFIED | VERIFIED | SUSPENDED
  economicUnderlyingId
  ibkrContract:
    conId, symbol, localSymbol, secType, exchange, primaryExchange,
    currency, timezone, tradingHours, lotSize
  perpContract:
    venue, symbol, base, quote, settlementCurrency,
    contractMultiplier, quantityStep, minimumQuantity
  equityUnitsPerPerpUnit
  verificationSource
  verifiedAt
```

The mapping is configuration, not inferred market data. Production eligibility requires `VERIFIED`; fixture mappings remain explicitly marked as fixtures.

### 6.2 Quote set

```text
CarryQuoteSet
  mappingId
  snapshotId
  ibkrBook: bids, asks, timestamp, marketDataType, marketState
  perpBook: bids, asks, timestamp
  funding: rate, intervalSeconds, nextFundingAt, predictionSource
  fxQuotes: pair, bid, ask, timestamp for every conversion edge
  capturedAt
```

`marketDataType` distinguishes real-time, frozen, delayed, and delayed-frozen IBKR data. Only real-time data is execution-eligible unless a future policy explicitly allows another type.

### 6.3 Opportunity and position

```text
CarryOpportunity
  mappingId, snapshotId, requestedNotional, horizonSeconds
  equityQuantity, perpQuantity
  equityVwap, perpVwap
  openingSpreadBps
  expectedFundingBps
  costBreakdown
  expectedExitBasisBps
  expectedNetReturnBps, expectedNetReturnAmount
  residualEconomicExposure, residualFxExposure
  assumptions, eligibility, ineligibilityReasons

CarryPosition
  strategyId, mappingId
  remainingEquityQuantity, remainingPerpQuantity
  averageEntryPrices
  realizedAndAccruedFunding
  commissionsAndFees
  residualEconomicExposure, residualFxExposure
  openedAt, updatedAt
```

All financial values are decimal strings at API boundaries. Timestamps are ISO 8601 UTC strings.

## 7. Calculation rules

### 7.1 Executable prices

Opening uses:

- IBKR equity ask-side VWAP for the executable equity quantity.
- Perpetual bid-side VWAP for the executable perpetual quantity.
- Conservative executable FX prices for each currency conversion.

Closing reverses the sides:

- IBKR equity bid-side VWAP.
- Perpetual ask-side VWAP.

If either book cannot fill the requested quantity within configured slippage, no estimate is produced and execution is ineligible.

### 7.2 Opening spread

After converting both prices to one reporting currency and one economic unit:

```text
openingSpreadBps = (perpSellVwap / equityBuyVwap - 1) * 10,000
```

A positive value is favorable at entry; a negative value is an opening cost.

### 7.3 Funding

Funding is a signed cash flow from the short perpetual position:

```text
expectedFundingIncome = perpNotional * expectedSignedFundingRate * expectedSettlementCount
```

Positive funding paid to shorts is positive income. Negative funding is a cost. The UI must show the next funding time, interval, prediction source, horizon, and settlement count; it must not imply that the current rate remains fixed.

### 7.4 Estimated return

```text
expectedNetReturn
  = openingSpreadValue
  + expectedFundingIncome
  - ibkrEntryCommission
  - ibkrEstimatedExitCommission
  - perpEntryFee
  - perpEstimatedExitFee
  - entryAndExitSlippage
  - fxConversionCost
  - equityFinancingAndHoldingCost
  - taxesAndInstrumentSpecificCosts
  - expectedExitBasisCost
```

The label is `Estimated strategy return`, never `maximum profit` or `guaranteed profit`. The result must include a cost breakdown and assumptions.

## 8. Read-only backend boundary

Introduce a feature service independent from `TradingRuntime`:

```text
CarryMarketService
  reads instrument mappings
  receives equity, perpetual, funding, and FX snapshots
  validates freshness and eligibility
  calculates VWAP opportunities
  publishes normalized snapshots
```

Initial local endpoints:

```text
GET /api/sk-hynix-carry/mappings
GET /api/sk-hynix-carry/opportunities?notional=...&horizonSeconds=...
GET /api/sk-hynix-carry/positions
```

The terminal WebSocket later gains feature-specific snapshot/update messages rather than encoding IBKR data as a CrossEx `market.update`.

The browser never connects directly to TWS, IB Gateway, an exchange, or an FX provider.

## 9. Adapter boundaries for later milestones

```text
IbkrMarketDataAdapter
  contract details, market-data type, top/depth quotes, market hours

PerpMarketDataAdapter
  contract metadata, depth, funding rate, interval, next settlement

FxMarketDataAdapter
  timestamped executable conversion quotes

IbkrExecutionAdapter
  submit, cancel, order status, fills, positions, reconnect recovery

PerpExecutionAdapter
  submit, cancel, order status, fills, positions, reduce-only
```

The TWS Node library is selected only after a compatibility spike verifies maintenance state, supported Node versions, contract lookup, market depth, order callbacks, executions, reconnection, and order-ID recovery. No library choice is embedded in the domain interfaces.

## 10. Simulated and live execution design

### 10.1 Separation

Simulation and live execution implement the same coordinator interfaces but use separate adapters and persist an explicit `environment`. Fixture or simulated records can never be resumed by live adapters.

### 10.2 One-click submission

One user action creates an immutable execution batch containing:

- strategy and mapping IDs;
- quote snapshot ID;
- requested and normalized quantities;
- both leg intents;
- slippage limits;
- an idempotency key.

After server-side preflight, the coordinator starts both submissions concurrently. There is no IBKR confirmation gate before the perpetual submission. Concurrency reduces timing skew but does not claim atomic execution.

### 10.3 State model

Each leg tracks:

```text
SUBMITTING
ACKNOWLEDGED
PARTIALLY_FILLED
FILLED
FAILED
CANCEL_PENDING
CANCELLED
UNKNOWN
```

The execution batch derives:

```text
submitting
acknowledged
partially_filled
filled
failed
compensating
manual_intervention
```

An ambiguous network result becomes `UNKNOWN`, not `FAILED`, until venue reconciliation establishes the remote state.

### 10.4 Compensation policy

Compensation is bounded and risk-reducing:

1. Reconcile both venues before acting on an ambiguous result.
2. Cancel unfilled remainders where possible.
3. Compare actual filled economic exposure, not requested quantities.
4. Submit only the quantity needed to reduce the imbalance within configured limits.
5. Stop after the configured attempt/time budget.
6. Enter `manual_intervention` with exact exposure and remote identifiers if balanced recovery cannot be proven.

No generic retry may duplicate a submission. All submits and repairs use durable idempotency/client order IDs.

## 11. Persistence for later execution milestones

Use new tables rather than overloading current crypto-only execution rows:

```text
carry_instrument_mappings
carry_strategy_positions
carry_execution_batches
carry_execution_legs
carry_fills
carry_funding_cashflows
```

Persist the raw venue identifiers needed for recovery, normalized decimal quantities, fill linkage, state transitions, failure reasons, and timestamps. Migrations remain immutable and checksummed under the existing repository rules.

On restart, the service must reconcile every non-terminal batch with IBKR and the exchange before accepting another action on the same strategy position.

## 12. Safety and eligibility

Opening is disabled when any condition fails:

- Mapping is not verified.
- IBKR contract identity or permissions are unavailable.
- Equity or FX quote is stale, delayed, or missing.
- Perpetual quote, depth, metadata, or funding interval is unavailable.
- The equity market is closed, unless a later explicit policy permits the current session.
- Either side lacks sufficient executable depth.
- Quantity violates lot, step, or minimum-size constraints.
- Residual exposure exceeds configured limits.
- TWS/Gateway, exchange stream, or reconciliation state is unhealthy.
- Another non-terminal batch owns the same strategy position.

The UI explains every failed check and never enables execution merely because a displayed price exists.

## 13. Testing

### Frontend

- Route serialization and reload behavior.
- Opportunity selection and ticket synchronization.
- Open/close mode changes.
- 25/50/75/100% close sizing and remaining-position preview.
- Disabled state and explicit reasons for stale, delayed, closed, unverified, or shallow markets.
- Accessibility for tables, tabs, status updates, and keyboard navigation.

### Domain and contracts

- Runtime-schema rejection of malformed contracts and timestamps.
- Decimal-safe VWAP across multiple levels.
- Bid/ask-correct FX conversion.
- Funding sign and non-eight-hour intervals.
- Equity integer/lot rounding, perpetual step rounding, and residual exposure.
- Full and partial close invariants.
- Cost breakdown and expected-exit-basis handling.

### Simulated coordinator

- Both acknowledgements and fills in either order.
- One-leg rejection before and after the other leg fills.
- Partial fills on either or both legs.
- Ambiguous submit followed by remote reconciliation.
- Cancel failure, bounded repairs, and manual intervention.
- Duplicate client request and process restart idempotency.
- Reduce-only enforced on every perpetual close and repair that reduces a short.

### Integration and end-to-end

- Read-only fixture page through the real Fastify and frontend API schemas.
- WebSocket reconnection without older snapshots overwriting newer state.
- SQLite restart recovery for simulated non-terminal batches.
- No execution network call is possible in read-only mode.

## 14. Delivery sequence and gates

1. **Formal read-only page:** React components, shared schemas, fixture endpoint, calculations, and tests. No external account connection.
2. **Read-only live market data:** verified instrument mappings, IBKR market-data adapter, perpetual depth/funding adapters, FX adapter, freshness and market-hours enforcement.
3. **Simulation:** persisted simulated positions and the dual-leg state machine, including compensation and restart recovery.
4. **Live-readiness review:** confirm contract identity, permissions, conversion ratios, FX risk, fees, tax/ADR costs, operational Gateway design, and risk limits.
5. **Live execution:** add execution adapters and enable the button only after explicit user authorization and live-readiness acceptance.

Each gate must pass its tests and operational review before work begins on the next stage. The implementation plan following this design covers stage 1 only; later stages receive their own plans after their prerequisites are verified.
