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
- Install: pnpm install
- Run locally: pnpm dev (needs apps/web/.env.local, see apps/web/.env.example)
- Build: pnpm build
- Apply migrations: pnpm migrate
- New migration after a schema change: pnpm --filter @big-simulation/web db:generate
- Test: pnpm test
- HTTP tests against the built app: pnpm test:http (see docs/DEPLOY.md)
- Typecheck: pnpm typecheck
- Lint: pnpm lint
- Format: pnpm format
- Everything CI's first job runs: pnpm check
(seed arrives with the scenario keys in phase 3.)

## Web app
- Every page calls requireUser() or requireInstructor() from
  apps/web/src/server/auth.ts itself. Nothing relies on a layout or a proxy
  having checked.
- Every instructor server action starts with requireInstructorForAction(),
  which also checks the Origin header. Every mutating route handler checks
  it with isSameOrigin().
- The signed-in person comes from findSessionUser(), which reads role and
  code from the roster row as it is now. Do not read users.role directly.
- Logic lives in apps/web/src/lib and takes the database as an argument, so
  it is tested without Next.js. Route handlers and actions stay thin.
- Messages, logs and audit rows never contain an email address or a name,
  and never repeat what a roster cell contained.
- Test fixtures use made-up people at the reserved domain college.example,
  never an address at a real domain.
