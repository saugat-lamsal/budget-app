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


## Design rules (Phase 4 onward)

- Built for an iPhone first. Respect the notch and the home bar. Tap
  targets are at least 44 points. Bottom tab bar: Home, Buckets, Review,
  Settings.
- Clean and modern, not flashy. System font, plenty of spacing, one accent
  color, subtle motion only. No charts yet.
- Light and dark mode, following the phone's setting.
- One main number per screen. On Home it is safe to spend.
- Money is always formatted the same way, digits aligned, negatives
  obvious.
- Color is never the only signal. Low, empty, overdue, and mismatch states
  also use words or an icon.
- Every screen has a loading state, an empty state, and an error state. The
  "totals do not match the bank" state is impossible to miss.
- Anything final or hard to undo asks first, such as "this is my paycheck".
- Readable contrast. The screens respect the phone's text size and
  reduced-motion settings.
- One shared set of building blocks (colors, type, spacing, card, list row,
  button, bucket bar, bottom sheet) is used on every screen. No screen
  makes up its own.


## Status

- Rulebook: draft 10. Section 15 confirmed (a to j), section 17 changes
  after the Phase 1 review, section 18 his answers (A1 to A10, and the
  items the second-opinion report found unclear), section 19 readings from
  QUESTIONS.md part B now in the rules, section 20 his answers to the
  Phase 3 questions (A12 to A16, B4, B20), section 21 his answers to the
  Phase 4 questions (A17, B82, B84: rules 0.5, 9.6, 10.6).
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
    back. `--only <test file>` shows what one test file catches by itself,
    and `--match <pattern>` runs only the breaks whose reason matches.
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
  - Since the A2 and A4 answers, some gas holds drop off without posting,
    and old card payments from savings come out of savings or needs.
- Phase 2, part two, the second-opinion tests: packages/money/second-opinion
  (PR #4), written from the rulebook by a session that had not seen the
  money code. Never edit them; a disagreement is settled against the
  rulebook. Its report's unclear items are now decided (rulebook 18e to
  18j, section 19), and A7 and A1 are built.
- Phase 2: finish line crossed Oct 6, 2026 (PR #4 merged; 5,000 simulated
  years with no self-check failure; both sets of tests pass). All of
  QUESTIONS.md part A is answered (A1 to A10) and built.
- Phase 3 (bank connection, test bank only): built Oct 7, 2026 on branch
  phase-3-bank-connection. Database: SQLite through better-sqlite3 (his OK,
  Oct 6). His Plaid sandbox keys are in .env.
  - packages/server: the sandbox lock (src/plaid/sandbox-lock.ts; the
    project-wide test test/sandbox-only.test.ts fails if anything points at
    a real Plaid environment), the sealed bank key (src/crypto, AES-256-GCM
    under BANK_TOKEN_KEY), a log that hides secrets, a Plaid client with
    read-only calls only, reading bank items (src/bank: amounts, bank rules,
    balances with pending charges, card statements), the sync (src/sync:
    plan.ts decides, sync.ts fetches and saves everything in one SQLite
    transaction with the cursor), setup day from the synced history
    (src/setup-day.ts), and a status report (src/status.ts). The book is
    rebuilt from its event log every time.
  - npm test runs it all offline: a made-up bank whose balances move like a
    real one (test/fake-plaid.ts), saved answers (test/fixtures; two were
    recorded from the real test bank), and 25 random scenarios
    (BANK_SCENARIOS=n runs more, SEED=n replays one).
  - npm run test:sandbox calls Plaid's real test bank (needs the network and
    the .env keys). LIVE_RECORD=<path> saves what it answered; never the
    calls that hand out keys.
  - Worked examples for the bank: packages/server/worked-examples.txt.
    Break-it: packages/server/break-it.json, section "bank".
  - The simulated you through the bank connection
    (test/simulated-life.test.ts): the Phase 2 simulator's bank, in Plaid's
    format, through the whole bank connection. Every day the self-check
    passes and the money matches the simulator's own book. npm test lives
    2 lives of 1 year; SIM_BANK_SEEDS, SIM_BANK_FIRST_SEED and
    SIM_BANK_YEARS run more (20 simulated years passed, Oct 7).
  - Plaid's test bank never moves balances when transactions are added, so
    after test-bank activity the self-check shows the activity as the gap.
    He accepted this as Phase 3's finish line (QUESTIONS.md A11, Oct 7);
    balances that really move get checked in Phase 7.
- Phase 3 merged as PR #5 (Oct 7, 2026).
- His answers to QUESTIONS.md A12 to A16, B4 and B20: built Oct 7, 2026 on
  branch answers-a12-to-a16, PR #6. All 384 breaks caught; 2,000 simulated
  years with every check passing, and 20 more through the bank connection.
  - Money math: a pending charge's new amount (4.6), the bank taking
    something back (4.10, with a log entry and alert 10.6), money leaving
    savings (4.9), "transfer between my accounts" in review (5.6), payments
    to people from either account (7.4, 8.1), "for mom" and three-way
    splits for payments to people (7.6), and late spending lowering the
    open leftover question (3.4).
  - Money leaving savings is its own kind of bank activity,
    'savings-withdrawal', not a purchase: the second-opinion helpers' types
    say a purchase is never on savings, and they must not be edited.
  - The bank connection sends a pending amount change, a removal, and a
    posted amount change to the book instead of waiting for his decision,
    and reads money leaving savings that no rule names as a withdrawal.
  - The simulator now also pays mom and bills from savings, adds tips while
    charges are pending, charges a purchase twice and takes the copy back,
    shows transfers as spending and a deposit for him to mark, and pays
    people "for mom" or split three ways.
- PR #6 merged (Oct 7, 2026).
- Phase 4 (the screens), started Oct 7, 2026 on branch
  phase-4-design-and-home. Design rules above (his list). Framework (his
  OK, with his changes): React + Vite in packages/web, plain CSS from one
  set of tokens, Playwright browser tests in Chromium and WebKit, the
  current tab in the address.
  - Step 3, the shared building blocks and Home on made-up data: built.
    He OK'd the look (Oct 7) and asked for: "left of $X" under each bucket
    amount; A17 option 2 (rule 9.6); a take-back on Home until seen (10.6,
    one of the two things the screens send, POST /api/seen); and the
    last checked safe to spend, greyed, "as of", when the bank cannot be
    read (0.5). All built. Then stop, before he merges.
  - packages/web/src/ui: tokens.css (colors, type, spacing, motion, safe
    areas), blocks.tsx (Money, Card, ListRow, Button, StatusLabel,
    BucketBar, Banner, BottomSheet, StateMessage), TabBar. Screens use
    only these.
  - The screens never work money out. packages/server/src/views/home.ts
    builds Home from the book (the money math); the web server
    (src/http/server.ts) serves the app and the screens' numbers
    (/api/home, /api/buckets, /api/review). It only takes two things from
    the screens (step 4): that a take-back was seen, and his choices.
  - npm run demo: made-up lives only (src/demo), no bank, no database
    (a test follows its imports). This computer only, unless --wifi.
    /demo picks a life. npm run screenshots: iPhone-size pictures, light
    and dark, into screenshots/ (not in git).
  - Browser tests (packages/web/test/browser, run by npm test): every
    number on Home against the money math, the tabs in the address,
    contrast (axe), 44-point tap targets, the notch and home bar, text
    size, reduced motion, random lives from the simulator (WEB_LIVES,
    WEB_FIRST_SEED), and the worked examples
    (packages/web/worked-examples.txt). SKIP_BROWSER_TESTS=1 leaves them
    out. Browsers: npx playwright install chromium webkit.
  - Break-it: packages/web/break-it.json, section "home". The browser
    tests run only for that section.
  - Found on Linux CI (Oct 7): WebKit there loses the answer to a request
    sent right after one it cancelled. The screens never cancel a request,
    send one at a time, refresh only after the app was really in the
    background, and give up after 15 seconds with Try again
    (packages/web/src/app/api.ts, test/browser/loading.test.ts). Keep it
    that way. A failing browser test reports what the page, the browser,
    and the test server were doing (harness.ts, waitOrReport).
  - PR #7 merged (Oct 7, 2026). Still to check: B80, B81, B83, B85 to B87.
- Phase 4, step 4, the Buckets and Review screens: built Oct 7, 2026 on
  branch phase-4-buckets-and-review, on made-up data only. Then stop, for
  his feedback.
  - Buckets (packages/web/src/screens/Buckets.tsx, packages/server/src/views/buckets.ts):
    everything in the buckets as the one main number (12.2), needs and
    wants bars, savings, the mom reserve with this month against the target
    (8.2), held for others (7.3), what waits in review, the old card debt
    (12.4), and the same "totals do not match the bank" banner as Home.
  - Review (Review.tsx, views/review.ts): every waiting item with exactly
    the choices the money math offers for it. The money package decides what
    is offered (src/review-options.ts, Book.reviewDetails), what a refund
    likely belongs to (src/likely-purchases.ts, 20d, A15), and what "this is
    my paycheck" would do (3.2, 3.3). The screen shows them and decides
    nothing. Final choices ask first (my paycheck, a payday answer, "always
    do this"): the screen asks, and the server refuses them without the yes.
  - How taps reach the books: POST /api/choice (src/choices.ts, the choice
    desk). It parses strictly, checks the choice is one offered for the
    item, hands it to the book, and answers done or refused with why
    (nothing changed). Each choice carries a decision number made once on
    the phone; a repeat of it gets the first answer back and changes
    nothing; a different number for an item already dealt with is told so.
    The screens' only writes are now /api/seen and /api/choice (the guard
    test packages/web/test/read-only.test.ts lists exactly those two).
  - The choices are kept in memory in the demo, one live book per made-up
    life (picking the life again starts it over). Keeping them with the
    book's history in the database is for the real server (Phase 6).
  - Demo lives added: review-busy (one of every kind of thing waiting) and
    buckets-busy. packages/money/test/busy-book.ts is the same idea for
    tests.
  - Tests: money (review-options*.test.ts, 12-app-side.test.ts), server
    (choices, views-buckets, views-review, http, demo), browser
    (buckets, review, design-screens, random-lives-screens, worked
    examples 7 to 11). The random-lives test taps random items and compares
    with a twin of the book. Break-it: the new breaks are tagged "[review]"
    (node scripts/break-it.mjs --match "\[review\]"; the screens' ones are
    section "home" and run the browser tests; use --only to judge them by
    one test file).
  - Waiting on: his feedback on the look, A18 and A19, and B88 to B96 to
    check.
- Waiting on: the promo end date for the old card. Only the payoff countdown
  (rule 9.5) depends on it.
