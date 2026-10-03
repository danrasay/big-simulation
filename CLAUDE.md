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
