# SK Hynix Arbitrage Read-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production React route and validated local fixture API for the fixed IBKR `000660` ↔ exchange `SKHYNIX` perpetual arbitrage strategy, with every execution control disabled.

**Architecture:** Shared Zod contracts define the fixed strategy spec, capabilities, opportunities, previews, and fixture positions. A backend-only fixture service returns deterministic read-only data through strategy-specific endpoints. A lazy-loaded frontend feature directory renders the opportunity ranking, open/close preview, dual-leg status, and records without importing existing CrossEx execution types.

**Tech Stack:** TypeScript 5.9, Zod 4, Fastify 5, React 19, Vitest 3, Playwright.

## Global Constraints

- Namespace page/API/types with `sk-hynix-arbitrage`, `sk_hynix_arbitrage`, or `SkHynixArbitrage` as appropriate.
- The only equity is IBKR/KRX `000660`; the client cannot submit another equity symbol.
- Perpetual choices come only from fixture `SKHYNIX` contracts approved by the server.
- Phase is always `READ_ONLY_FIXTURE`; all opportunities and previews are ineligible for execution.
- Do not install an IBKR library, connect TWS/CrossEx accounts, add database migrations, or add an order endpoint.
- Do not modify existing execution tables or existing strategy behavior.
- Preserve `docs/sk-hynix-tws-strategy-demo.html`.
- Do not commit changes; the user explicitly requested no direct commits.

---

### Task 1: Shared SK Hynix contracts

**Files:**
- Create: `packages/shared-types/src/sk-hynix-arbitrage.ts`
- Create: `packages/shared-types/src/sk-hynix-arbitrage.test.ts`
- Modify: `packages/shared-types/src/index.ts`

**Interfaces:**
- Produces `SkHynixArbitrageCapabilitiesSchema`, `SkHynixArbitrageSpecSchema`, `SkHynixArbitrageOpportunityQuerySchema`, `SkHynixArbitrageOpportunitiesResponseSchema`, `SkHynixArbitragePreviewRequestSchema`, `SkHynixArbitragePreviewSchema`, and `SkHynixArbitragePositionsResponseSchema` plus inferred types.
- Decimal amounts remain strings; timestamps use `z.iso.datetime()`.

- [ ] Write tests proving fixture responses parse, arbitrary equity symbols cannot appear, execution eligibility is literal `false`, and invalid decimal/timestamp values fail.
- [ ] Run `npm test -w packages/shared-types -- sk-hynix-arbitrage.test.ts` and verify failure because schemas do not exist.
- [ ] Implement the schemas in the dedicated module and export them from `index.ts`.
- [ ] Run the targeted shared-types test and typecheck.

### Task 2: Deterministic backend fixture API

**Files:**
- Create: `apps/backend/src/sk-hynix-arbitrage-fixture.ts`
- Create: `apps/backend/src/sk-hynix-arbitrage-fixture.test.ts`
- Modify: `apps/backend/src/app.ts`
- Modify: `apps/backend/src/app.test.ts`

**Interfaces:**
- Produces `skHynixArbitrageCapabilities()`, `skHynixArbitrageSpec()`, `querySkHynixArbitrageOpportunities(input)`, `previewSkHynixArbitrage(input)`, and `skHynixArbitragePositions()`.
- Adds `GET /api/sk-hynix-arbitrage/capabilities`, `GET /api/sk-hynix-arbitrage/spec`, `POST /api/sk-hynix-arbitrage/opportunities/query`, `POST /api/sk-hynix-arbitrage/previews`, and `GET /api/sk-hynix-arbitrage/positions`.
- POST routes require exact read-intent headers `sk-hynix-arbitrage-opportunities` and `sk-hynix-arbitrage-preview`.

- [ ] Write fixture unit tests for deterministic ranking, venue selection, close percentages, remaining quantities, and immutable `eligible: false`.
- [ ] Write Fastify tests for response Schema validity, missing intent `403`, invalid body `400`, and absence of any trading endpoint.
- [ ] Run targeted backend tests and verify they fail before implementation.
- [ ] Implement the pure fixture service and register the five read-only routes.
- [ ] Run targeted backend tests and typecheck.

### Task 3: Frontend API and pure sizing helpers

**Files:**
- Modify: `apps/frontend/src/api.ts`
- Modify: `apps/frontend/src/api.test.ts`
- Create: `apps/frontend/src/sk-hynix-arbitrage/close-sizing.ts`
- Create: `apps/frontend/src/sk-hynix-arbitrage/close-sizing.test.ts`
- Create: `apps/frontend/src/sk-hynix-arbitrage/calculations.ts`
- Create: `apps/frontend/src/sk-hynix-arbitrage/calculations.test.ts`

**Interfaces:**
- Adds API methods `skHynixArbitrageCapabilities`, `skHynixArbitrageSpec`, `skHynixArbitrageOpportunities`, `skHynixArbitragePreview`, and `skHynixArbitragePositions`.
- Produces `closeFractionQuantity(remainingEquityQuantity, fraction)` using integer-safe stock sizing and `formatSignedBps/formatSignedMoney` for display only.

- [ ] Write API tests for exact paths, read-intent headers, serialized bodies, and rejection of invalid fixture responses.
- [ ] Write sizing/calculation tests for 25/50/75/100 percent, no over-close, and signed formatting.
- [ ] Run targeted frontend tests and verify failure before implementation.
- [ ] Add API methods and pure helpers.
- [ ] Run targeted frontend tests and typecheck.

### Task 4: Lazy-loaded read-only strategy page

**Files:**
- Create: `apps/frontend/src/sk-hynix-arbitrage/route.tsx`
- Create: `apps/frontend/src/sk-hynix-arbitrage/opportunity-table.tsx`
- Create: `apps/frontend/src/sk-hynix-arbitrage/order-ticket.tsx`
- Create: `apps/frontend/src/sk-hynix-arbitrage/execution-lanes.tsx`
- Create: `apps/frontend/src/sk-hynix-arbitrage/positions-panel.tsx`
- Create: `apps/frontend/src/sk-hynix-arbitrage/styles.css`
- Modify: `apps/frontend/src/frontend-routes.ts`
- Modify: `apps/frontend/src/frontend-routes.test.ts`
- Modify: `apps/frontend/src/App.tsx`

**Interfaces:**
- Exports `SkHynixArbitrageRoute` with no trading-runtime props.
- Adds route kind `skHynixArbitrage` mapped to `/strategies/sk-hynix-arbitrage`.
- The strategy menu label is `SK hynix arbitrage` and its detail states `IBKR 000660 vs SKHYNIX perpetuals`.

- [ ] Extend route round-trip tests first and verify failure.
- [ ] Add the route kind, menu item, lazy import, and dedicated App branch without extending `StrategyConfigSchema`.
- [ ] Build the page with loading/error states, opportunity selection, OPEN/CLOSE tabs, amount input, 25/50/75/100 close controls, preview refresh, disabled `Read-only preview` button, and positions/orders/history tabs.
- [ ] Ensure status and table content use semantic headings, buttons, tabs, tables, and live regions; add responsive styles scoped under `.sk-hynix-arbitrage`.
- [ ] Run frontend tests, typecheck, and build.

### Task 5: End-to-end safety and regression verification

**Files:**
- Modify: `e2e/app.spec.ts`

**Interfaces:**
- Verifies the strategy menu and `/strategies/sk-hynix-arbitrage` route against the real local Fastify fixture API.

- [ ] Update keyboard-navigation expectations for the new final strategy item.
- [ ] Add an E2E test that opens the page, selects an opportunity, switches OPEN/CLOSE, selects a partial close fraction, and proves every execution button is disabled.
- [ ] Run the focused Playwright test.
- [ ] Run `npm run lint`, `npm run typecheck`, targeted unit tests, `npm run build`, and the full E2E suite.
- [ ] Inspect `git diff --check` and `git status --short`; confirm no dependency, migration, real-account, Demo, or commit changes.
