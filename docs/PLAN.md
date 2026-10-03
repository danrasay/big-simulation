# Big Simulation Online: Architecture and Development Plan

As of October 2, 2026. Prepared for Dan Rasay.

> This is the public part of the plan. The Test fixtures and Source errata sections state expected answers, so they live in the private `big-simulation-keys` repo as `KEYS.md`.

The Big Simulation becomes one web app: students sign in with their lclark.edu Google account, pick a role, and work on Best Buy and Nvidia statements that recompute as they go. This plan fixes the architecture and splits the build into phases Claude Code can run in order.

## Decisions for Dan

Nine choices change what gets built. The plan below assumes the default in each row, so Claude Code can start without waiting; change a row and the affected phase changes with it.

| # | Decision | Default assumed in this plan | If you choose otherwise |
| --- | --- | --- | --- |
| 1 | Which roles ship first | Investor and Investigator first (their numbers can be checked automatically), then Company, then Disruptor as a structured workbook | Reorder phases 3 to 6; nothing else moves |
| 2 | What the database stores about a student | Pseudonymous: a student code plus a keyed hash of the email. No names or emails at rest. The code-to-name roster stays in Zone B | Storing plain emails is simpler to build but puts identifiable records on the host, so get L&C IT sign-off on the vendor first |
| 3 | Who gets in | lclark.edu Google account AND on the course roster. Domain alone admits every student, faculty and staff account at the college | Domain-only is one config flag (`REQUIRE_ROSTER=false`) |
| 4 | Where the Google OAuth client lives | A Google Cloud project inside the lclark.edu organization, consent screen set to Internal, if L&C IT allows it | Outside the org it must be External; the server-side `hd` check in this plan covers both cases |
| 5 | Hosting | Vercel for the app, Supabase for Postgres (its own project, used as a plain database: no Supabase Auth, web API off), with a Dockerfile kept so it can move to Cloud Run | If IT wants it in a college-owned cloud project, deploy the same container to Cloud Run with Cloud SQL |
| 6 | AI feedback on student writing | Off. The app checks numbers and coverage; you grade the prose | Adding it later means sending student text to a model, which is a Zone A/B question, not a code question |
| 7 | Share prices for P/E and dividend yield | Not in the exhibits. You supply one price per company at fiscal year end as scenario data | Without prices, those two ratios are hidden rather than guessed |
| 8 | Solo practice or live market | Teams work against the fixed exhibits first. A live round where Company filings feed Investors and Investigators comes in phase 7 | Skip phase 7 and the app is still complete for the original assignment |
| 9 | Repository visibility | Private now, public later, to share with other institutions. Nothing that states an expected student answer ever enters the code repo. Keys, the instructor manual and section-specific scenarios live in a second private repo from the first commit | If it will stay private for good, one repo is enough |

One thing only you can do: ask L&C IT whether the Workspace admin restricts third-party sign-in. If it does, they must allow this app's OAuth client ID, or students see `Error 400: access_not_configured`.

## What gets built

Each of the four roles in the project description becomes a workspace. The app checks what has a fixed answer and leaves judgment to you.

| Role | What the team does online | What the app checks | What stays with the instructor |
| --- | --- | --- | --- |
| Investor (Role III) | Reads Exhibits 1 and 2 side by side. Computes all 20 Exhibit 5 ratios for both companies by clicking the line items that feed each formula. Writes the interpretation, reliability view and industry notes. Splits 100% of capital across the two companies and names the preferred one | Each ratio against the answer key within tolerance. Whether the cited line items match the formula. Allocation sums to 100%. Every required prompt answered | Quality of interpretation, research and suggestions |
| Investigator (Role IV) | Sees Exhibit 4 as a year-over-year difference view with the materiality thresholds applied. Flags line items, files each flag under questions a to f, writes the evidence, lists missing footnotes | Which of the six answer-key findings the flags cover. Flags under the threshold are marked immaterial. Each flag has a category and evidence | Strength of the argument. Valid findings outside the key |
| Company (Role II) | Starts from Exhibit 1 or 2. Applies adjustments from a catalog built on Exhibit 3, or a manual journal entry. Statements recompute and stay balanced. Each adjustment needs a footnote and a justification. Ends with a 2 minute pitch script | Balance sheet balances. Change in total assets and in net income against the starting statements. Adjustments with no footnote. Inputs outside the scenario's defensible range. Options that are not GAAP | The pitch, the defense under questioning, gray-area legality |
| Disruptor (Role I) | Fills a workbook structured on requirements a to e, then runs a stress test: the app presents 10 fixed transactions and the team shows how its system records each | Completion only | Everything else |

Three rules hold across all roles:

- **The app does not grade.** It records work and automatic checks. The 200 points, the oral presentation and the written report stay in class, and each workspace exports a black-and-white printable report to support them.
- **Exhibit 4 is labeled as altered.** Its fiscal 2022 figures are invented for the exercise. Every screen and export that shows them says so, so nobody mistakes them for Best Buy's reported results.
- **Attribution is on every page footer.** The source project is CC BY 4.0, which requires credit to Goldblatt, Branco Chaves, Landman, Mwinjuma and Vitelli, a link, and a note that the material was adapted.

Not in this plan: a gradebook, LMS integration, AI feedback, and recomputing the cash flow statement. Adjustments update the balance sheet and income statement only.

## Architecture

One web application does everything: it signs students in, serves the role workspaces and runs the accounting engine on the server. The browser never receives an answer key, and the database never receives a name.

**System diagram (text form).** Only the server sees identity and answer keys.

- Browser (student or instructor) -> Google sign-in (OpenID Connect): sign in with Google.
- Google sign-in -> Web app: signed ID token.
- Browser -> Web app over HTTPS. The web app is one deployment with three layers, top to bottom:
  1. Sign-in and gates: ID token check, lclark.edu, roster.
  2. Role workspaces: four roles and the instructor console.
  3. Engine: adjustments, ratios, materiality. Answer keys stay on the server.
- Web app -> Postgres over SQL: codes and hashes, team workspaces, scenarios and keys.
- Secret store -> Web app: pepper, OAuth secret.
- Zone B (the instructor's own machine) <-> Browser: roster in, coded export out. Names and the code map live only in Zone B.

Students reach the app only through a browser. Names stay in Zone B, the pepper and OAuth secret stay in the host's secret store, and the answer keys stay on the server.

| Layer | Choice | Why |
| --- | --- | --- |
| App | Next.js with the App Router, in TypeScript. Pages and server actions in one deployment | One codebase and one deploy for Claude Code to manage. Server rendering keeps keys off the client |
| Engine | A pure TypeScript package in the same repo | Testable with no browser and no database |
| Database | Postgres, with typed queries and migrations (Drizzle) | A relational fit for teams, workspaces and ordered adjustments |
| Sign-in | A hand-built OpenID Connect code flow: two requests to Google written directly, and a JWT verification library (`jose`) for the ID token | One provider, and full control over what is stored. Auth.js has been in maintenance mode since September 2025, and framework user tables hold name and email by default. The small OAuth client library first planned (arctic) was deprecated by the time phase 1 was built |
| Hosting | Vercel for the app, Supabase for Postgres. A Dockerfile is kept in the repo | Little to operate for a class-sized app, on a database plan already paid for. Row-level security is on for every table with no policies, so Supabase's web API can read nothing even if it is left on. The container moves to Cloud Run unchanged if IT asks |
| Interface | Server-rendered React, light theme only, in the ELI document style: black on white, Arial, 1px rules | Matches the course documents and prints in black and white |
| Tests | Unit and property tests for the engine, browser tests for each role's flow, an authorization test per route | The engine is where a silent error would mislead a class |
| Logs | Host logs plus the audit table. No third-party analytics | No student activity goes to another vendor |

## Access control

Three gates sit between a Google account and a workspace: Google's sign-in, a server-side check of the ID token, and the course roster. The second gate is the one that enforces lclark.edu.

### Sign-in flow

1. Any request without a session goes to `/login`, which offers one button: Sign in with Google.
2. The server starts the OpenID Connect authorization code flow with PKCE. Scopes are `openid email profile`. It sends a random `state` and `nonce` (kept in a short-lived HttpOnly cookie), `hd=lclark.edu` and `prompt=select_account`.
3. On the callback the server checks `state`, exchanges the code, and verifies the ID token: signature against Google's published keys, `iss` is `https://accounts.google.com`, `aud` is this app's client ID, `exp` has not passed, `nonce` matches.
4. **Domain gate.** Reject unless the token's `hd` claim equals `lclark.edu` and `email_verified` is true. The `hd` request parameter in step 2 only pre-selects the account picker. Google's documentation says not to rely on it, and not to rely on the email's suffix either. The `hd` claim inside the signed token is the value to trust.
5. **Roster gate.** Compute a keyed hash of the lowercased email and look it up in the roster of an open section. No match shows a plain page: signed in with an lclark.edu account, not on the roster for this course, contact the instructor. Nothing is stored for that visitor.
6. **Session.** On a match, create the user on first visit and issue a 256-bit random session token. The database stores only its SHA-256 hash. The cookie is `__Host-session`, HttpOnly, Secure, SameSite=Lax, with an 8 hour idle timeout and a 7 day maximum.

Google access and refresh tokens are discarded after step 3. The app calls no Google APIs.

### What is stored about a student

| Data | At rest | Notes |
| --- | --- | --- |
| Google account ID (`sub`) | Keyed hash only | The stable key for a returning user; Google advises `sub` over email |
| Email address | Keyed hash only | Used once per sign-in to match the roster |
| Name and photo | Never | First name rides in the user's own signed cookie for the greeting |
| Student code | Yes | The same codes used in the Zone B quiz exports |
| Team and workspace content | Yes | Linked to student codes, never to names |

The instructor uploads the roster as a CSV with columns `email,student_code,section`. The server hashes each email in memory with HMAC-SHA256 and a secret pepper, stores the hash and the code, and does not keep the file. The code-to-name map stays in Zone B.

A keyed hash is pseudonymous, not anonymous. Anyone holding the pepper and a list of college emails could re-identify students, so the pepper lives only in the host's secret store and is destroyed in the end-of-term purge.

### Authorization rules for Claude Code

- Two roles: `student` and `instructor`. The instructor role comes from the roster row, never from a client-supplied value. The first instructor is bootstrapped from a `BOOTSTRAP_INSTRUCTOR_EMAIL` environment variable, compared in memory at sign-in and never written to the database.
- Every server action re-checks the session, the section and the team before reading or writing. IDs are UUIDs and are never trusted on their own.
- Answer keys, the instructor manual findings and other teams' drafts are resolved on the server. They never ship in a student's page bundle or API response.
- Every mutating request checks the `Origin` header in addition to SameSite cookies.
- Rate-limit the callback route and all writes. Log sign-ins, submissions and instructor actions to an audit table, by student code.
- Build the flow by hand with a JWT library, not a full auth framework. The app has one provider and must control exactly what is persisted; the common frameworks store name and email by default.

### Google Cloud setup (Dan, about 20 minutes)

- [ ] Create a Google Cloud project and an OAuth client of type Web application
- [ ] Add redirect URIs `https://<production-domain>/auth/callback` and `http://localhost:3000/auth/callback`
- [ ] Consent screen: Internal if the project sits in the lclark.edu organization, otherwise External and published, with only the three sign-in scopes
- [ ] Ask L&C IT to allow the client ID under Workspace app access control
- [ ] Put the client ID, client secret, pepper and session secret in the host's environment settings, never in the repo

## Simulation engine

All accounting logic lives in one pure TypeScript package, `packages/engine`, with no UI or database imports. The server calls it to apply adjustments and check answers; the tests call it directly.

### Statement model

- A **scenario** is versioned JSON: one company, its fiscal years, line items, parameters, catalog bounds and, in a separate server-only file, the answer keys.
- A **line item** has an `id`, label, statement, section, normal balance, a value per fiscal year, and a `sourceRef` naming the exhibit table it was transcribed from.
- Subtotals and totals are formulas over line items, never stored numbers. A footing test asserts each computed total equals the total printed in the exhibit.
- Amounts are integers in $ millions. Each journal entry computes its last leg by subtraction, so debits equal credits exactly and rounding can never unbalance the sheet.

### Adjustment mechanics (Company role)

Every adjustment is a balanced journal entry over line items. A pre-tax income change flows through in three legs: income tax expense moves by the scenario's effective rate (Best Buy 24.4%, Nvidia 1.7%), the tax lands in accrued liabilities, and the remainder lands in retained earnings. A property test applies random sequences of adjustments and asserts assets equal liabilities plus equity after every one.

| # | Adjustment (from Exhibit 3) | Team inputs | Entry before tax | Total assets | Net income | Guardrail |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Allowance for doubtful accounts | Allowance as % of gross receivables | Dr SG&A, Cr receivables for an increase | Down when raised | Down when raised | Scenario range. Best Buy starts at 3.5% (38 on 1,099). Footnote: change in estimate |
| 2 | Factoring receivables | Amount sold, fee % | Dr cash, Dr loss on sale, Cr receivables | Down by the fee | Down by the fee | Amount cannot exceed receivables. Footnote required |
| 3 | Pledging receivables | Amount borrowed, interest rate | Dr cash, Cr short-term debt; Dr interest expense, Cr cash | Up by the loan less interest | Down by the interest | Loan capped at the scenario advance rate. Footnote: pledged assets |
| 4 | Depreciation method and life | Straight-line or double-declining; average life | Difference from base-year expense, against accumulated depreciation | Up when expense falls | Up when expense falls | Life inside the disclosed ranges. Method change needs a preferability footnote |
| 5 | Impairment of long-lived assets | Asset class, amount, triggering event | Dr impairment loss, Cr the asset | Down | Down | Cannot exceed carrying value. Reversals and upward revaluation are blocked as not GAAP |
| 6 | Inventory cost method | Weighted average, FIFO or LIFO | Inventory restated by the scenario's cost-layer spread, offset in cost of sales | FIFO up, LIFO down | FIFO up, LIFO down | Footnote: change in accounting principle, with justification |
| 7 | Contingent liability | Loss accrued, probable-and-estimable assertion | Dr SG&A, Cr accrued liabilities | Unchanged | Down | Above the scenario ceiling is flagged as reserve padding |
| 8 | Sales incentives | Extra sales, % deferred as incentive | Dr cash; Cr revenue and deferred revenue; Dr cost of sales, Cr inventory at the base cost ratio | Up by the gross margin | Up | Above the scenario cap is flagged as pulling demand forward |
| 9 | Sales returns and warranty estimates | Reserve as % of revenue | Returns: Dr revenue. Warranty: Dr cost of sales. Both Cr accrued liabilities | Unchanged | Down when raised | Scenario range |
| 10 | Bad debt method | Allowance or direct write-off | Direct write-off removes the allowance: Dr receivables, Cr SG&A | Up | Up | Selectable, and flagged not GAAP when bad debts are material. A deliberate trap |
| 11 | Amortization life of intangibles | Average life | Same mechanics as row 4, against intangible assets | Up when life lengthens | Up when life lengthens | Scenario range. Footnote: change in estimate |
| 12 | Goodwill impairment | Amount | Dr impairment loss, Cr goodwill | Down | Down | Cannot exceed goodwill. No reversal, no write-up |
| 13 | Lease classification | Share of operating leases treated as finance | Moves that share of lease assets and liabilities to finance lines; expense rises by the scenario front-loading factor | Slightly down | Down | Classification follows contract facts. Above the scenario's count of borderline leases is flagged not GAAP |
| 14 | Manual journal entry | Lines, amounts, footnote | As entered; must balance | Any | Any | No automatic verdict. Queued for instructor review |

The table shows why the assignment's goal is a real trade-off. Only pledging (row 3) raises assets while lowering income; rows 7 and 9 lower income and leave assets alone; most other levers move both the same way. Teams have to combine them.

Three behaviors complete the Company workspace:

- **Disclosure gaps.** An adjustment with no footnote still applies, and the filing lists it as an unexplained change. This is the online form of requirement (e): blanks make investors suspicious.
- **Scoreboard, not a score.** Each team is plotted by percent change in total assets and in net income from the starting statements, with counts of not-GAAP, out-of-range and unexplained items. An optional weighted score is an instructor setting.
- **Assumptions panel.** The cost-layer spread, front-loading factor, ranges and caps are scenario parameters you set, and the workspace shows them to students. They are teaching simplifications, and the screen says so.

### Ratio engine (Investor role, and live in the Company workspace)

- The 20 ratios in Exhibit 5 are data: id, group, formula over line-item ids, unit, accepted variants.
- A submitted value passes within 1% relative or 0.01 absolute of the key or an accepted variant. The response says which definition matched. A percent ratio may be entered as a percent or as a fraction: 22.4 and 0.224 both read as 22.4%.
- Exhibit 5 is ambiguous in four places, so each has a key and an accepted variant:

| Ratio | Key definition | Also accepted |
| --- | --- | --- |
| Debt ratio | Total liabilities / total assets | Interest-bearing debt / total assets |
| Times interest earned | (Earnings before tax + interest expense) / interest expense | Operating income / interest expense |
| EPS, dividend payout | Weighted average basic shares, which matches reported EPS | Period-end shares |
| Receivables turnover | Revenue stands in for net credit sales, which the 10-Ks do not disclose | None |

- Return on common equity uses ending equity, as Exhibit 5 writes it. Return on assets and the turnover ratios use the two-year average.
- P/E and dividend yield read the share price from scenario parameters and are hidden when it is absent.
- **Show your work.** The student builds a formula by clicking line items in the statement. The engine compares the cited ids with the formula's inputs, which covers the requirement to demonstrate one calculation.

### Investigator checks

- **Difference view.** For every line item, the change and percent change from fiscal 2021 to the altered fiscal 2022.
- **Materiality.** Two scenario parameters, 1% of net sales and 10% of net income, plus the base year. The project description does not say which year or whether both tests must be met. The default is the prior year (473 and 180, in $ millions) and either test.
- **Finding.** One or more line items, a category from questions a to f, and evidence text.
- **Coverage.** The six findings in the instructor manual are mapped to line-item ids. A finding counts as covered when a flag cites any of its items. Coverage is computed on the server and shown to students only after you release it.

### Disruptor stress test

Ten fixed transactions cover requirements a to e: a cash sale, a credit sale, an inventory purchase on account, a payroll accrual, depreciation, a prepaid expense, unearned revenue earned, a loan, a dividend and an owner investment. The team records each in its own system, in free text or a small table. Nothing is auto-checked.

## Data model

Sixteen Postgres tables hold everything. A workspace's statements are never stored as editable numbers: they are the scenario's base figures plus that workspace's adjustments replayed in order.

| Table | Holds | Key columns |
| --- | --- | --- |
| `sections` | One course section per term | term, name, status, settings (roster required, materiality base, release flags) |
| `roster` | Who may enter | section, email hash, student code, role |
| `users` | A roster entry that has signed in | `sub` hash, student code, role, section |
| `sessions` | Live sign-ins | token hash, user, last seen, expires |
| `teams` | A team or a solo student, and its role | section, name, role, join code |
| `team_members` | Membership | team, user |
| `scenarios` | Versioned scenario JSON, public part | slug, version, body |
| `scenario_keys` | Answer keys | scenario, version, body. Readable by the server role only |
| `workspaces` | One team's work on one scenario | team, scenario and pinned version, status, submitted at, row version |
| `adjustments` | Company entries, in order | workspace, sequence, catalog id, inputs, postings, footnote, justification, flags |
| `ratio_answers` | Investor values | workspace, company, ratio id, value, cited line items, check result |
| `responses` | Free-text answers to role prompts | workspace, prompt id, body |
| `findings` | Investigator flags | workspace, line items, category, evidence |
| `allocations` | Investor capital split | workspace, target company or filing, percent |
| `filings` | Frozen copy of a submitted Company workspace | workspace, statements, footnotes, flags |
| `audit_log` | Sign-ins, submissions, instructor actions | time, student code, action, target |

Four rules go with the tables:

- **Replay, not overwrite.** Undo deletes the last adjustment and replays the rest. The postings saved with each adjustment are the audit trail.
- **Pinned versions.** A workspace keeps the scenario version it started on, so editing a scenario mid-term cannot change a team's numbers.
- **Team edits.** `workspaces.row_version` gives optimistic locking. A stale write is rejected with a reload prompt. There is no live co-editing.
- **Purge.** A script deletes a section's roster, users, sessions and audit rows after the coded export is taken. Scenarios stay.

## Build phases

Nine phases, run in order, each ending in a deployed state with its checks passing. After phase 4 the app is usable in class for two roles against the fixed exhibits.

| Phase | Builds | Size | Done when |
| --- | --- | --- | --- |
| 0. Foundation | Both repos, strict TypeScript, lint, test runner, CI, a synthetic practice scenario for the public tests, `CLAUDE.md`. Scenario JSON transcribed from Exhibits 1, 2 and 4, each number with its `sourceRef` | S | Footing tests pass for every printed total in Exhibits 1 and 2 and in the unaltered years of Exhibit 4. The altered column of Exhibit 4 is checked by a golden test in the keys repo. CI is green |
| 1. Access | Sign-in flow, domain gate, roster gate, sessions, roles, roster upload. Deployed with a placeholder home page | M | A personal Gmail account is refused. A forged token with a wrong or missing `hd` is refused in a unit test. A college account not on the roster sees the not-on-roster page and leaves no row. Instructor routes return 403 to students. A database dump contains no email address and no name |
| 2. Engine | Statement model, ratio engine, difference view, materiality, coverage | M | Every value in the Test fixtures section of `KEYS.md` is reproduced by the golden tests in the keys repo. The code repo's own tests pass on the synthetic scenario. No UI yet |
| 3. Investor | Side-by-side statements, ratio entry with click-to-cite, written prompts, allocation, submit | M | A test team completes all 40 ratio entries, gets per-ratio feedback and submits. An automated check confirms no answer key value appears in any response sent to a student |
| 4. Investigator | Difference view, flag and classify, missing-footnote list, submit | M | The view marks the same material items as the fixtures. Coverage stays hidden until released |
| 5. Company | Adjustment engine, the 14 catalog entries, workbench, footnotes, scoreboard, live ratios, undo | L | Each catalog entry has a unit test for its postings and flags. The balance property test passes over 10,000 random sequences. Undo restores the prior statements exactly |
| 6. Instructor console | Sections, open and close, progress by team, read any workspace, release keys, coded export, print views, purge script, Disruptor workbook | M | The export contains student codes only. Print views are legible in grayscale. Purge removes one section's people data and nothing else |
| 7. Market round (optional) | Company filings publish to the section. Investors allocate across classmates' filings. Investigators audit them. A scoreboard for the classroom screen | L | A scripted class of 6 teams runs a full round: file, allocate, audit, reveal |
| 8. Hardening | Accessibility pass, authorization test per route, security headers, dependency audit, load test, backup and restore drill, runbook | M | Keyboard-only completion of each role. 60 concurrent users with no errors. A restore from backup verified |

### Phase 1 as built

Where phase 1 differs from the text above, or leaves something for later:

- **Database host.** Supabase instead of Neon (decision 5). Deployment steps are in `docs/DEPLOY.md`.
- **No OAuth client library.** The two OAuth requests are written directly and the ID token is verified with `jose`.
- **403 for students.** Instructor pages answer 403 through Next.js's `forbidden()`, which is still behind an experimental flag. If the flag is ever removed the call throws, so the page fails closed.
- **Roster changes take effect at once.** A signed-in person's role and code are read from their roster row on every request. Removing the row, or closing the section for a student, ends the session. An instructor's row keeps working when its section is closed, so the instructor can reopen it.
- **No way yet to remove one person.** A roster upload adds and updates. Removing a single student arrives with the instructor console in phase 6; until then, closing the section is the way to end access.
- **Someone on several rosters.** An instructor row wins over a student row; among equals, the newest row is used.
- **Rate limiting is not built yet.** It needs a shared counter store. Proposed for phase 8 with the other hardening work, unless you want it sooner.
- **The Dockerfile is not built yet.** Vercel does not need it. Proposed for phase 8.
- **Not yet checked on a live deployment.** The checks that need a real Google sign-in are listed in `docs/DEPLOY.md`, section 6.

Rules that apply to every phase:

- **One phase per pull request.** Claude Code stops at the end of each phase and reports the checks, so you review before the next one starts.
- **Engine tests come first.** Fixtures are written into tests before the code that satisfies them. A failing fixture is reported, never edited to pass.
- **No invented numbers.** A scenario parameter that this plan does not define (a range, a cap, a share price) is a question for you, not a guess.
- **Current docs over memory.** Library versions and APIs are checked against their documentation at build time. This plan pins none.

## Handoff to Claude Code

Claude Code needs three things in a repo: this plan, the source files, and a `CLAUDE.md` that states the rules it must not break. Phases 0 and 2 need nothing from you; phase 1 needs the Google Cloud checklist done.

1. Create two private repositories: `big-simulation` for the code, which goes public later, and `big-simulation-keys`, which stays private.
2. In `big-simulation`, save this plan as `docs/PLAN.md` without the Test fixtures and Source errata sections. Those two sections go in the keys repo as `KEYS.md`. The full plan is kept in the Claude project as `claude/big-simulation-dev-plan.md`.
3. Copy the project description and Exhibits 1 to 6 into `docs/source/` in `big-simulation`. Put the instructor manual in the keys repo.
4. Add the `CLAUDE.md` below at the root of `big-simulation`.
5. Open Claude Code with both repositories attached and paste the kickoff prompt.

### Two repositories

Making a repository public also publishes its full history, so a key committed once and deleted later is still exposed. The split therefore starts at the first commit.

| Lives in | What |
| --- | --- |
| `big-simulation` (public later) | App and engine code. Scenario data for Exhibits 1, 2 and 4. A synthetic practice company with invented round numbers, used by every test in this repo. The plan without fixtures and errata. Attribution and license files |
| `big-simulation-keys` (private) | The instructor manual. The findings key and coverage mapping. Golden tests that run the engine against the fixtures, on a checkout of the code repo. Any Exhibit 4 variant you write for a section, with its key. The seed script that loads keys into the `scenario_keys` table |
| Neither | Rosters, `.env` files, the pepper, database dumps |

Three consequences follow:

- **The deployed app never reads the keys repo.** Keys reach it only through the seed script, into the database.
- **Stock exhibits lose their secrecy once the code is public.** Anyone can run the engine on Exhibits 1 and 2 and read off the ratios, and the original manual is already downloadable. For a section where that matters, use an Exhibit 4 variant kept in the keys repo.
- **Licensing is settled before the flip.** Material adapted from the Gettysburg project stays under CC BY 4.0, with credit and a note of what changed. The license for your own code is your choice.

### CLAUDE.md

```text
# Big Simulation Online

Read docs/PLAN.md before doing anything. It is the spec. If the plan and the
code disagree, stop and ask.

## How to work
- Build one phase at a time, in the order in docs/PLAN.md. One pull request
  per phase.
- At the end of a phase, run its "Done when" checks, report each result, stop.
- Write engine tests before the code: synthetic-scenario tests in this repo,
  golden fixture tests in the keys repo. Never change a fixture to make a
  test pass. Report the mismatch instead.
- Check library versions and APIs against current documentation, not memory.

## Hard rules
- This repo will become public, history included. Never commit answer keys,
  expected student answers, the instructor manual, section-specific
  scenarios, rosters, database dumps or secrets. Keys live in the
  big-simulation-keys repo. Tests here cover engine behavior on the
  synthetic scenario, plus data-integrity checks on the exhibit scenarios
  (schema, and footing against the totals printed in the exhibits).
- Never persist an email address, a name, a photo, or a Google token. Only
  keyed hashes and student codes are stored.
- Access requires hd == "lclark.edu" and email_verified == true in a verified
  ID token, then a roster match. The hd request parameter is not a control.
- At runtime, answer keys are read on the server from the scenario_keys
  table. Nothing from them may reach a student response or a client bundle.
- All accounting logic lives in packages/engine. No arithmetic on statement
  values in UI code.
- Every number in scenario data carries a sourceRef to an exhibit. Do not
  invent numbers. A missing parameter is a question for Dan.
- Every screen or export that shows Exhibit 4 states that its fiscal 2022
  figures are altered for teaching.
- Every page footer credits the source project (CC BY 4.0) and says the
  material was adapted.
- Secrets come from environment variables. Commit .env.example, never .env.

## Interface
- Light theme only. Black on white, Arial, 1px rules, tables as the main
  component.
- Print views must read correctly in black and white.
- Plain, direct copy that addresses the student as "you".

## Commands
(Fill in during phase 0: install, dev, test, lint, typecheck, migrate, seed.)
```

### Kickoff prompt

```text
Read CLAUDE.md and docs/PLAN.md in full, then the files in docs/source/,
then KEYS.md in the big-simulation-keys repo. Exhibit 5 is an image-only
PDF, so view it as an image.

Before writing code, reply with:
1. Anything in the plan that is ambiguous or conflicts with the source files.
2. The scenario parameters you still need from me.
3. Your file layout for phase 0, in both repos.

Then wait for my go-ahead and build phase 0 only.
```

## Sources

- [Financial Statement Analysis Project: "The Big Simulation"](https://cupola.gettysburg.edu/oer/13/), Goldblatt, Branco Chaves, Landman, Mwinjuma and Vitelli, Gettysburg College, December 2022. Licensed CC BY 4.0. The project description, Exhibits 1 to 6 and the instructor manual in this project come from it.
- [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), Google Identity. Source for the `hd` claim, ID token validation steps, and the advice to key users on `sub`.
- [Developer best practices following enhancements to third-party app access controls](https://developers.google.com/classroom/best-practices/access-control-enhancements), Google for Education. Source for the admin allow-list and the `access_not_configured` error.
- [Auth.js is now part of Better Auth](https://www.better-auth.com/blog/authjs-joins-better-auth), Better Auth, September 22, 2025. Background for the choice not to build on an auth framework.
