# Changelog

All notable changes to Gate CrossEx are documented in this file.

## [0.2.1] - 2026-08-10

### Added

- Added a bilingual interactive CLI update check that detects newer published GitHub releases and offers to run the existing update workflow before startup.

### Changed

- Update checks now skip non-interactive launches, development branches, pinned source refs, offline failures, and sessions with `GCT_SKIP_UPDATE_CHECK=1`.
- Source bootstraps now validate that the update-check helper is present before activating a downloaded source tree.

## [0.2.0] - 2026-08-10

### Added

- Added a Boros by Pendle fixed-rate workflow for comparing and executing fixed funding-rate opportunities.
- Added asset-grouped positions with immediate or scheduled, batched reduce-only closing.
- Added account trading-fee comparison by market.

### Changed

- Funding rates now use each venue's native settlement interval, with normalized comparisons, more efficient refreshes, and last-known-good data retention.
- Strategy launches and direct orders now validate margin requirements and leverage-tier position limits before execution.
- Strategy reconciliation and recovery now handle maker/taker execution and residual hedge repair more robustly.

### Fixed

- Added stop and log support for close-position strategies.
- Kept funding data available when optional Gate or Binance market metadata cannot be loaded.
- Updated the transitive `nanoid` dependency to a release without high-severity audit findings.
