# SK Hynix Demo-Parity Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the production `/strategies/sk-hynix-arbitrage` React route to match the interaction and information hierarchy in `docs/sk-hynix-tws-strategy-demo.html` while keeping all execution local and simulated.

**Architecture:** The backend fixture remains the source of deterministic opportunity, quote, FX, preview, and position data. Pure frontend helpers derive Demo display calculations and simulated execution states. Focused React components reproduce the Demo sections without importing or invoking the existing live strategy runtime.

**Tech Stack:** TypeScript 5.9, Zod 4, Decimal.js, React 19, Vitest 3, Playwright.

## Global Constraints

- Treat `docs/sk-hynix-tws-strategy-demo.html` as the layout and interaction source of truth.
- Keep the fixed mapping `IBKR/KRX 000660 ↔ approved SKHYNIX perpetual`.
- Do not add a real execution endpoint, install an IBKR library, connect TWS, or submit Gate orders.
- The execute button drives an in-browser simulation only and must say that it is simulated.
- Delete the simplified standalone `PositionsPanel`; replace it with the Demo record tabs.
- Preserve the Demo file and all unrelated user changes.
- Do not commit.

---

### Task 1: Demo calculation model and richer fixture quotes

**Files:**
- Modify: `packages/shared-types/src/sk-hynix-arbitrage.ts`
- Modify: `packages/shared-types/src/sk-hynix-arbitrage.test.ts`
- Modify: `apps/backend/src/sk-hynix-arbitrage-fixture.ts`
- Modify: `apps/backend/src/sk-hynix-arbitrage-fixture.test.ts`
- Create: `apps/frontend/src/sk-hynix-arbitrage/demo-model.ts`
- Create: `apps/frontend/src/sk-hynix-arbitrage/demo-model.test.ts`

**Interfaces:**
- Opportunity responses expose executable stock bid/ask in KRW and normalized USDT, perpetual bid/ask, USD/KRW, USDT/USD, and quote latency.
- `deriveDemoOrder(...)` returns integer equity shares, hedge quantity, both notionals, mismatch, FX exposure, executable spread, and expected net return.

- [x] Write failing Schema, horizon, and open/close calculation tests.
- [x] Run targeted tests and verify the missing fields/helper failures.
- [x] Extend the strict Schema and deterministic fixture; calculate funding settlements from `horizonSeconds` instead of hardcoded venue returns.
- [x] Implement the pure Demo calculation helper.
- [x] Run targeted tests and typechecks.

### Task 2: React page parity with the approved Demo

**Files:**
- Modify: `apps/frontend/src/sk-hynix-arbitrage/route.tsx`
- Modify: `apps/frontend/src/sk-hynix-arbitrage/opportunity-table.tsx`
- Modify: `apps/frontend/src/sk-hynix-arbitrage/order-ticket.tsx`
- Modify: `apps/frontend/src/sk-hynix-arbitrage/execution-lanes.tsx`
- Delete: `apps/frontend/src/sk-hynix-arbitrage/positions-panel.tsx`
- Create: `apps/frontend/src/sk-hynix-arbitrage/health-strip.tsx`
- Create: `apps/frontend/src/sk-hynix-arbitrage/hedge-market-panel.tsx`
- Create: `apps/frontend/src/sk-hynix-arbitrage/safety-strip.tsx`
- Create: `apps/frontend/src/sk-hynix-arbitrage/records-panel.tsx`
- Modify: `apps/frontend/src/sk-hynix-arbitrage/styles.css`

**Interfaces:**
- Route state owns selected opportunity, horizon, open/close mode, partial-close shares, simulated execution phase, and record tab.
- Components receive typed fixture data and callbacks only; none imports live-order APIs.

- [x] Add a failing route/E2E assertion for Demo headings, controls, and record tabs.
- [x] Implement health, ranking controls, hedge/FX/metrics, synchronized lanes, Demo order ticket, safety checks, and record tabs.
- [x] Make opportunity selection and perpetual selector synchronize.
- [x] Make open/close, all/partial close, quick sizes, remaining position, and Reduce-only display synchronize.
- [x] Implement deterministic simulated submit transitions: submitting → acknowledged → filled, with current-order and history record updates.
- [x] Scope responsive/light-theme CSS under `.skha-demo` and match the Demo hierarchy.
- [x] Run frontend tests, typecheck, and build.

### Task 3: Safety and regression verification

**Files:**
- Modify: `e2e/app.spec.ts`

**Interfaces:**
- The E2E flow proves Demo parity and that no request carries a trading intent during simulated execution.

- [x] Update the SK Hynix E2E flow for ranking selection, horizon change, open preview, partial close, record tabs, and simulated execution.
- [x] Verify the real-submit route remains absent and the page describes execution as simulated.
- [x] Run lint, full typecheck, unit/integration tests, production build, and focused Playwright using the available system Chrome.
- [x] Run `git diff --check` and inspect `git status --short`; confirm no commit, dependency, migration, real credential, or Demo changes.
