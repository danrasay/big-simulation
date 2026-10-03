# Scenarios

A scenario is one company's balance sheet and income statement for a few periods, as versioned JSON. The engine in `packages/engine` reads these files; nothing else holds statement figures.

| File | Source | Notes |
| --- | --- | --- |
| `best-buy-fy2021.json` | Exhibit 1 | Fiscal year ended January 30, 2021 |
| `nvidia-fy2021.json` | Exhibit 2 | Fiscal year ended January 31, 2021 |
| `best-buy-fy2022-altered.json` | Exhibit 4 | The fiscal 2022 column is invented for the Investigator exercise. It is not Best Buy's reported result |
| `synthetic-practice-co.json` | None | An invented company with round numbers. Tests of engine behavior run on this file |

## Rules

- **Every number cites its source.** Each line item, total and fact has a `sourceRef` naming the exhibit table it was transcribed from. The validator rejects a scenario without one.
- **Totals are formulas.** A total lists its `terms`. Where the exhibit prints the total, the printed figure is kept in `printed` so the tests can check the formula against it. Totals the exhibit does not print, such as Best Buy's total liabilities, have no `printed` figure.
- **Amounts are whole $ millions**, stored in each line's natural direction: an expense of 52 is stored as 52, and the formula subtracts it. A dash in the exhibit is stored as 0. A period the exhibit does not report is left out.
- **Facts are everything else**: share counts, per-share figures, dividends. They may have decimals.
- **Altered periods are not checked here.** A scenario lists the periods whose figures were invented for teaching under `altered`. The tests in this repository check that every other period foots and balances, and make no claim about the altered ones.
- **A scenario's version goes up when its data changes.** Work in progress is pinned to the version it started on.

## Shared ids

The same concept has the same id in every scenario, so one formula works for every company: `revenue`, `cost_of_sales`, `gross_profit`, `operating_income`, `interest_expense`, `income_before_tax`, `income_tax_expense`, `net_income`, `receivables_net`, `inventories`, `total_current_assets`, `total_assets`, `total_current_liabilities`, `total_liabilities`, `total_equity`. Labels stay as each exhibit prints them.
