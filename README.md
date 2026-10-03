# Big Simulation Online

A web application for a financial statement analysis role-play. Students sign in, take one of four roles (Disruptor, Company, Investor, Investigator) and work on real annual-report excerpts from Best Buy and Nvidia.

It adapts the open educational resource "The Big Simulation" from Gettysburg College. See [ATTRIBUTION.md](ATTRIBUTION.md).

## Status

Under construction. The build follows [docs/PLAN.md](docs/PLAN.md), one phase at a time. Done so far: phase 0 (the statement model, the scenario data and the checks that the data foots) and phase 2 (the ratio engine, the year-over-year difference view, the materiality test and the coverage check). There is no web app yet.

## Layout

| Path | What |
| --- | --- |
| `docs/PLAN.md` | Architecture and development plan |
| `docs/source/` | The source project's description and exhibits, as Markdown |
| `scenarios/` | Statement data transcribed from the exhibits, plus a synthetic practice company for tests |
| `packages/engine/` | The accounting engine: pure TypeScript, no platform or UI imports |
| `CLAUDE.md` | Working rules for Claude Code in this repo |

## Development

Requires Node 22.13 or later and pnpm.

```sh
pnpm install
pnpm check   # typecheck, lint, format check and tests, as CI runs them
```

TypeScript is held at 6.0 because the lint tooling (typescript-eslint 8) does not yet support TypeScript 7.

## License

The license for the code has not been chosen yet. Material adapted from the source project is under CC BY 4.0, as described in [ATTRIBUTION.md](ATTRIBUTION.md).
