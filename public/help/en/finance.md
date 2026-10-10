# Finance Workbench

The Finance Workbench combines local research cards, manually sourced snapshots, deterministic backtests, screening, and paper trading. These features do not require an external data key. Built-in DEMO values are illustrative, not live market data.

Finance uses the shared three-region interface: application navigation on the left, data/analysis/account pages in the function area, and the selected page in the main view. It does not open a separate overlay.

## Optional QVeris data

Capability discovery finds relevant live or historical data operations. Review the quoted cost and provenance before executing a paid operation.
If the external service rejects a request, the workbench shows its HTTP status without echoing the upstream error body. Check the key, credits, and request parameters before retrying.

## Snapshots

Saved snapshots retain symbol, currency, as-of time, and source provenance so later analysis remains auditable. Include QVeris tool, search, and execution IDs only when an actual call supplied them.

## Backtests and screening

Backtests use deterministic next-bar execution with explicit fees and slippage. The screener reports factor contributions and missing-data coverage.

## Paper trading

Paper accounts and orders are isolated simulations. They never submit real brokerage orders.

Successful snapshots, backtests, and screening results are added to Artifacts automatically. An archival failure does not hide the completed analysis.
