# Budget App

A personal budget and paycheck tracker for one person (Saugat). It reads his
Bank of America accounts through Plaid, splits each paycheck into buckets,
sorts transactions, and sends reminders. He opens it on his iPhone as a web
app added to the home screen.

The full behavior is in the rulebook. The build order is in the roadmap.
Read both before doing anything.

@budget-app-rulebook.md
@budget-app-roadmap.md


## Why this project is strict

This handles real money. A previous app he built had nice features but got
core things wrong. Correctness comes before features, every time.


## How to work

- Follow the roadmap one phase at a time. Do not start a phase until the
  previous one has crossed its finish line. Stop and report at each finish
  line.
- The rulebook is the source of truth. If the code and the rulebook
  disagree, the code is wrong. If the rulebook is unclear or missing a case,
  stop and ask. Do not guess, and do not change the rulebook without his OK.
- Every numbered rule gets at least one test, named after the rule number
  (for example "4.6 pending charge counts once").
- Write the test before the code for each rule.
- Never weaken, skip, or delete a failing test to make it pass. Fix the code
  or raise the question.
- Any bug found later becomes a test first, then gets fixed.


## Testing bar for every phase

This applies to every phase and every session, cloud or local.

1. Tests before code. At least one test per numbered rule, named after the
   rule number. Watch each test fail before writing the code that makes it
   pass.
2. Edge cases for every rule: zero, one cent, negative, very large amounts,
   and exact boundaries (exactly at the mom cap, exactly at the alert level,
   a paycheck smaller than the reserve).
3. Break-it check. After a section passes, break the code on purpose in
   several ways (flip a sign, change a rounding, shift a boundary by one
   cent). Some test must fail each time. If none does, add the missing test.
   Restore the code afterward.
4. Random-scenario tests as soon as a section exists, for things that must
   always be true: paycheck parts add up exactly, no cent is created or
   lost, own-account transfers never change a bucket, the self-check holds.
5. Worked examples. Keep a plain-text file of examples with made-up numbers,
   calculated step by step, that Saugat can check by hand
   (packages/money/worked-examples.txt). Each one is also a test.
6. Type-check and run the full test suite (`npm test`) before every commit.
   Never skip, weaken, or delete a failing test.
7. End-of-phase report: a table of every rule and its tests, the test
   count, the break-it results, and anything not tested and why.


## Technical decisions already made

- TypeScript everywhere.
- The money math is its own package with no screens, no network, no
  database, and no clock of its own. Dates and times are passed in so tests
  can control them.
- All amounts are whole cents, stored as integers. No floating point for
  money anywhere.
- Web app (installable on the iPhone home screen) with a small backend and a
  database. Hosting gets chosen in Phase 6.
- Login by passkey. One user.
- Notifications by web push from the installed home-screen app.
- Nothing is hard-coded. Percentages, amounts, thresholds, rules, and timing
  are all settings (rulebook section 2).


## Safety rules

- The app is read-only toward the bank. Never add anything that moves money.
- Plaid test bank (sandbox) only until Phase 7. Do not connect real accounts
  before then. The free plan allows 10 connections total and removed ones do
  not come back, so never create a real connection for testing.
- The Plaid access token lives on the server only, encrypted. It never goes
  to the browser or the phone.
- No secrets in the repo. Use environment variables and keep .env out of
  git.
- No real account numbers, names, or balances in tests, logs, or commits.
  Test data is made up.


## Testing layers (roadmap phases 1, 2, 4)

1. One or more tests per rulebook rule.
2. A simulator that invents a realistic money life and fast-forwards through
   years of it. The daily self-check (rulebook section 12) must pass on
   every simulated day.
3. Random-scenario tests against things that must always be true: paycheck
   parts add up exactly, nothing is counted twice, own-account transfers
   never change a bucket.
4. An independent set of tests written from the rulebook by a separate agent
   that has not seen the code.
5. Browser tests that use the app like a person and compare the screens to
   the money math.


## How to talk to him

- Plain language, bottom line first, short.
- Plain text over formatted documents.
- When something needs a decision, give the options and a recommendation.


## Status

- Rulebook: draft 7. Section 15 confirmed (a to j), section 17 changes
  after the Phase 1 review, section 18 his answers (A5 to A8, A1, and the
  items the second-opinion report found unclear), section 19 readings from
  QUESTIONS.md part B now in the rules.
- Phase 0 (setup): finish line crossed Oct 6, 2026. `npm test` type-checks
  everything, then runs every test. Saugat still has to add his Plaid sandbox
  keys to .env (not needed until Phase 3).
- Phase 1 (the money math): finish line crossed Oct 6, 2026, merged as
  PR #1, follow-ups as PR #2. Every numbered rule has a passing test. The
  payoff countdown (9.5) was built later, with A7 (PR #4); it stays off
  until he enters the promo end date.
  - The money math is in packages/money. The book (src/book.ts) applies
    bank activity and his answers one at a time; every bucket can be
    recounted from scratch (recountPots).
  - Worked examples: packages/money/worked-examples.txt. Each "Check:" line
    is read by a test.
  - Break-it check: `node scripts/break-it.mjs` (or with section numbers).
    The breaks are listed in packages/money/break-it.json; add new ones there
    for each section. Do not edit source or test files while it runs: it
    breaks the source on purpose. It first runs the tests with nothing
    broken and stops if they fail. If a run is stopped partway, the test
    suite fails until `node scripts/break-it.mjs --restore` puts the file
    back. `--only <test file>` shows what one test file catches by itself.
- CI: GitHub Actions runs `npm test` on Linux and Windows for every pull
  request (.github/workflows/test.yml).
- Phase 2 (stress testing), part one, the simulated you: built Oct 6, 2026
  on branch phase-2-simulator (PR #3).
  - packages/money/test/sim: a made-up person lived one day at a time
    against the simulator's own bank (posted balances, pending charges,
    transfers in two halves). Every day: the self-check, a recount, the old
    card debt, money in transit, safe to spend, alerts, card notices, and
    what each transaction and answer should have done to the buckets,
    worked out from the rulebook. The person also tries things the
    rulebook does not allow; the app must refuse them and change nothing.
  - npm test lives 6 lives of 2 years. `node scripts/simulate.mjs` lives
    1,000 lives of 5 years on every core; `--seed N --years Y` replays one.
    A failure prints its seed and day, and becomes a test before any fix.
  - It leaves out what is not built or still waiting on his answers (A2, a
    pending charge that vanishes; A3 and A9 follow today's behavior).
- Phase 2, part two, the second-opinion tests: packages/money/second-opinion
  (PR #4), written from the rulebook by a session that had not seen the
  money code. Never edit them; a disagreement is settled against the
  rulebook. Its report's unclear items are now decided (rulebook 18e to
  18j, section 19), and A7 and A1 are built.
- Next: Phase 2's finish line once PR #4 is merged (thousands of simulated
  years with no self-check failure, and both sets of tests passing), then
  Phase 3 when he says go. Still open: QUESTIONS.md part A (A2 to A4, A9,
  A10).
- Waiting on: the promo end date for the old card. Only the payoff countdown
  (rule 9.5) depends on it.
