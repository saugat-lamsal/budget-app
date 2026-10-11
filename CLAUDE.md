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
   Restore the code afterward. Run break-it only for the sections you
   changed. Do one full run at the end of each phase.
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

- Rulebook: draft 18. Section 15 confirmed (a to j), section 17 changes
  after the Phase 1 review, section 18 his answers (A1 to A10, and the
  items the second-opinion report found unclear), section 19 readings from
  QUESTIONS.md part B now in the rules, section 20 his answers to the
  Phase 3 questions (A12 to A16, B4, B20), section 21 his answers to the
  Phase 4 questions (A17, B82, B84: rules 0.5, 9.6, 10.6), section 22
  his answers to the Buckets and Review questions (A18, A19: rules 4.5,
  6.1, 13.2), section 23 his answers after the bucket lists, hand moves
  and Payday review (A20: rule 5.6; the Payday card's reason: rule 3.4),
  section 24 his answers after the Settings screen (A21 to A24: rules
  5.6, 13.1, 13.2, and the bank rules in section 2), section 25 his
  answers after Setup day (A25, A26: section 2, 4.5, 14.2), section 26
  his answers after bank rules (A27, and the home time zone: section 2),
  section 27 his answers after the real server (A28: rule 0.6; A29: 4.5,
  6.1; 27c staying logged in, 27d syncing every 60 minutes, section 2),
  section 28 his answers after syncing on a timer (A30: rule 0.6; A31: rule
  13.7), section 29 his answers after Phase 4's finish line (A32: rule 13.7;
  A33: rule 4.5), section 30 his answers after the alerts were kept (A34 to
  A39: rules 9.7, 10.4, 10.5, 10.7 to 10.10, and section 2).
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
    for each section. It never changes the project folder, so other work can
    continue while it runs (edits made after it started are not tested).
    See "Break-it runs in parallel" below.
- CI: GitHub Actions runs `npm test` (.github/workflows/test.yml), in three
  jobs at once since Oct 9, 2026 (one job took 38 min 46 s against 45):
  "checks" (the type check, then every test without a browser,
  SKIP_BROWSER_TESTS=1), "chromium" and "webkit" (the browser tests in one
  engine each, BROWSER_ENGINE). test/ci-workflow.test.ts checks that together
  they are exactly npm test. To save Actions minutes: Linux on every pull
  request; Windows only when he starts it by hand (Actions, Tests, Run
  workflow, pick the branch; it asks Windows, Linux, or both, Windows by
  default), for a phase's finish line. Each browser job keeps its own browser
  between runs (one copy per system, browser and Playwright version); Linux
  still installs its system libraries each run.
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
  branch phase-4-buckets-and-review (PR #8), on made-up data only. Then
  stop, for his feedback.
  - Buckets (packages/web/src/screens/Buckets.tsx, packages/server/src/views/buckets.ts):
    everything in the buckets as the one main number (12.2), needs and
    wants bars, savings, the mom reserve, what was sent to mom this month
    against the target (8.2), held for others (7.3), what waits in review, the old card debt
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
    one test file, --file to take only the breaks in some files, and the
    environment variable BROWSER_ENGINE=chromium to judge by one engine).
  - His review before merging (Oct 7): A18 option 2 and A19 option 2,
    built. A refund in review can be matched to a likely purchase
    (Book.sort with { refundOf }, final, so it asks first); a new rule
    sorts what it can and leaves the rest waiting (addRule, changeRule and
    sortAlways return stillWaiting; the desk names them). "Transfer between
    my accounts" now says what each account does, from the money math
    (ReviewOptions.transferOutcome): to the old card from checking comes
    out of needs (5.2); from savings it comes back to pick savings or
    needs. Buckets shows the mom reserve as its own row, and what was sent
    this month in its own card, "Sent to mom".
  - PR #8 merged (Oct 7, 2026). Still to check: B88 to B96.
- Phase 4, step 5, the lists of what went in and out of a bucket, moving
  money by hand, and Payday: built Oct 8, 2026 on branch
  phase-4-activity-moves-payday (PR #9), on made-up data only. Then stop,
  for his feedback.
  - The book now keeps a ledger (packages/money/src/activity.ts): a line each
    time something changes what a bucket holds, stamped with the pay period
    it was counted in, and undone with a refused answer. Book.activity (one
    bucket's list), Book.periodSummary, Book.paydayReport (payday-report.ts)
    and Book.resortDetail (resort.ts) read from it; the screens work out
    nothing. For every bucket and pay period, carried in + came in + went
    out = now, to the cent (B97), and the simulator checks that every day.
    A pay period starts when the book counts the paycheck (B53, B97).
  - Activity (screens/Activity.tsx, views/activity.ts, /buckets/<bucket>):
    tapping a bucket on Buckets lists what went in and out of it this pay
    period, newest first. Tapping a row sorts it again (4.7) with the same
    choices Review gives, including "always do this" (13.6); what cannot be
    sorted again says why. Sorting again uses the same facts as Review
    (#spendFacts); a test checks that the book accepts exactly the choices
    offered.
  - Moves (screens/Move.tsx, from Buckets and from each list): 13.3, with 13.4's
    questions coming from the desk (needs-confirmation with its reasons).
  - Payday (screens/Payday.tsx, views/payday.ts, /payday, linked from Home
    and Buckets): what the last paycheck did step by step, the amount to
    move to savings (3.8), the leftover questions (3.4) and the summary of
    the pay period that ended.
  - Taps reach the books through the same desk and the same one address,
    POST /api/choice: { resort: true } for sorting again and a move request
    for moves. Repeats of a decision change nothing; a refusal changes
    nothing and says why. The screens still write only /api/seen and
    /api/choice (read-only.test.ts).
  - Shared choosing for Review and the lists: screens/choose.tsx.
  - Demo lives added: activity-busy and payday-paid. Worked examples: money
    27 to 29, screens 12 to 14.
  - Tests: 2,095 pass (471 more than PR #8 ended with): money 992, server
    489, web 64, browser 535 (Chromium and WebKit). Random lives: 100
    simulated lives of 3 years with every check passing, including the new
    "every bucket's list adds up" check. Browser tests: bucket lists,
    moves, Payday, design rules (design-activity), random lives with random
    taps against a twin of the book. The accessibility and tap-size checks
    now wait for animations to finish (design-helpers.ts atRest): a button
    just tapped, or a sheet still sliding in, made them fail now and then.
  - Found on CI (Oct 8, WebKit on Linux and Windows): after a move went
    through, the screen was redrawn with the sheet's button enabled again
    and the sheet closed a moment later (a passive effect), so a second tap
    in that moment sent a second request. The BottomSheet now opens and
    closes in a layout effect, in the same step as the redraw. The tests
    watch for the moment itself (watchSheetsAfterAnAnswer in screens.ts)
    rather than depend on tap timing. The contrast test is one test per
    colour scheme now: both together came close to the 60-second limit.
  - Found on Windows CI (Oct 8): a page closed with its refresh still on
    its way made WebKit lose the answer to the next page's request (the same
    thing as the Oct 7 note above). The tests that close or leave a page
    after a change wait for what is on its way first: untilQuiet in
    harness.ts (it looks at the page's fetch and XHR requests only: its own
    document was sometimes never reported finished on Windows). Waiting for
    "network idle" does not do it, since that only waits the first time a
    page goes idle. And the test servers answer every request with
    Connection: close (harness.ts listen, test/test-server.test.ts), so
    WebKit has no connection to reuse after a cancelled request or one the
    server is closing. A page is handed over quiet too (openScenario and
    openLive call untilAnswered: Home's numbers are asked for on every
    screen, and a test that closed the page cancelled that request, which
    stalled the next page on Linux CI, Oct 8). The count of fetches on their
    way is kept inside the page, where it is exact; Playwright's own events
    can arrive late in WebKit, and it never says an error answer (500)
    finished. The Windows job's time limit is 45 minutes (it was cut off at
    30 on Oct 8, when the tests had got slower), and the old contrast test
    in design.test.ts is one test per colour scheme too.
  - Break-it: new breaks are tagged "[activity]" (100). The existing breaks
    for code the refactor moved (49) were pointed at where it is now. Run
    for the sections changed (the testing bar): every one caught, none
    survived. The full run is at the end of Phase 4.
  - His review (Oct 8): A20 option 2, and the Payday card says why, both
    built.
    - A20: a purchase marked as a payment to the old card, from checking, is
      on Needs' list as that, and its sheet (resortDetail, marked) offers
      what the purchase could be before it was marked. Picking a bucket
      makes it the purchase the bank sent (Book.sort restores it first);
      picking Needs used to be refused. The account it is marked with is not
      offered again, and marking it with the same account is refused.
      "Always do this" makes the rule for the purchase it was. B110. Demo
      life: activity-marked. Worked examples: money 30, screens 15.
    - Payday card: a question that late spending made smaller (B4) says
      "$657.11 at payday, less $34.67 spent before payday and sorted
      since", on Payday and in Review, and the line stays on the summary
      after you answer. The numbers are the money math's (LeftoverReport
      and the leftover review item have lessSincePayday; the item has
      atPayday). B109. Worked example: money 31, screens 14 (a new Check
      line). The simulator checks on every day that what is asked plus what
      was taken off is what was held at payday (leftoverProblems).
    - Found while building it, fixed with a test first (B111): rolling over
      after late spending lowered the question reported the full payday
      amount as kept, not what the question asked.
    - Break-it, only for what this round changed (his OK to cut it down):
      the 21 new breaks, all caught. The full run is still at the end of
      Phase 4.
  - PR #9 merged (Oct 8, 2026). Waiting on: A21 (the same undo for a
    payment marked from savings) and B97 to B111 to check. The real server
    must keep decision numbers with the book's history (B103, Phase 6).
- Break-it runs in parallel, and no longer touches the project folder (Oct 8,
  2026, branch break-it-parallel). The command is the same,
  `node scripts/break-it.mjs` (engine: scripts/break-it-lib.mjs).
  - Each worker has its own copy of the code: a git worktree in the temp
    folder (budget-app-break-it), made from the last commit plus whatever is
    changed, staged, new, or deleted in the project folder when the run
    starts. A break is applied only in that copy; the project folder is never
    written, so other work can go on while it runs. Edits made after the run
    started are not tested. Files git ignores are not copied, so a copy has no
    .env (the one test that reads it skips itself there).
  - Every copy is the project as it was at the start of the run, though the
    copies are not all made at that moment: the first is, the others after the
    nothing-broken check, which can take minutes. So the run pins the commit
    once (its id, not "HEAD"), copies the files that differ from it into a
    folder of its own in the run's temp folder once, and notes the list of
    packages once, all at the start; every copy is built from that and never
    reads the project folder again. An edit, a new file, a deleted file, or a
    commit made in the project during the check is in no copy (before this, the
    later copies read the project as it was by then: a mix of old and new code
    that never existed, or a crash on a file deleted meanwhile). node_modules
    itself is still linked when each copy is made; it is not code under test.
  - `--workers N` sets the number of workers; the default is the number of
    cores minus 2 (14 on this PC). `--workers 1` is one break at a time. The
    nothing-broken check runs once, alone, in the first copy, before the other
    copies are made and the workers start. The list comes out in the order of
    the break lists whatever the order the workers finished in; progress and
    the time taken go to stderr.
  - What a copy shares and keeps: node_modules is made of directory links to
    the project's, except that a package of this repo is linked to the copy's
    own folder (a link to the project's would run the unbroken code and every
    break would survive); .vite caches are not shared; the screens are built
    in each copy. Each copy has its own TEMP, TMP, and TMPDIR, so no two
    workers share a browser profile. The test servers listen on port 0, so the
    system gives each its own free port. Each copy's vitest is given its share
    of the cores (--maxWorkers).
  - Clean-up: the copies are removed when the run ends and on Ctrl+C (the
    links first, so nothing removing a copy can reach the project's
    node_modules). The copies of a run that was killed are removed by the next
    run, or by `node scripts/break-it.mjs --restore`, which also still puts
    back any file an older version of the script left broken
    (<file>.break-it-backup). The guard test (test/break-it-guard.test.ts) is
    unchanged and still fails while such a backup exists.
  - The number in "caught (N tests failed)" is not the same from run to run,
    with any number of workers and also with the old one-at-a-time script: some
    tests (fast-check properties without a fixed seed, the random lives) pick
    random cases each run. What must match is which breaks are caught.
  - Measured on this PC (Ryzen 7 9800X3D, 8 cores, 16 threads; 14 workers),
    the old one-at-a-time script against this one on the same breaks:
    sections 11 and 8 (19 breaks) 4 min 39 s against 2 min 4 s; the four
    breaks in bank/amounts 1 min 40 s against 59 s; section 3 (45 breaks)
    9 min 25 s against 3 min 26 s; two screens breaks 7 min 30 s against
    5 min 55 s. Which breaks were caught was the same for all 70 (69 caught;
    one could not be applied, in both). Part of every run is the
    nothing-broken check, done once either way (about 40 s, or 2 min 30 s
    when a screens break is in the list), so short lists gain little. One
    break without browsers costs about 12 s one at a time and about 4 s in
    parallel. A screens break gains almost nothing: its browser tests already
    use the whole CPU, about 2 min 30 s each either way (13 at once took about
    32 minutes). Some are slow by themselves: "the numbers disappear while
    they are fetched again" (src/app/api.ts) took 13 minutes alone, with 98
    tests failing, many of them waiting out timeouts. Use a smaller
    `--workers` if the PC is needed for something else.
  - The script's own tests: test/break-it.test.ts, on a made-up project (never
    this one), 31 tests. They are skipped inside a break-it run
    (BREAK_IT_RUN=1, like SKIP_BROWSER_TESTS): no break touches them. The
    script itself was broken on purpose 53 ways (flip the links to the
    project, skip the files changed since the commit, share the temp folder,
    forget to put the file back, pin nothing at the start, and so on) and
    every one is caught by those tests.
  - Merged as PR #10, with every copy made from the same start as PR #12, and
    the B4 break pointed at the code again as PR #11 (Oct 8, 2026).
- A stale break now fails the tests (Oct 9, 2026, branch phase-4-settings,
  its own commit). test/break-it-lists.test.ts, in npm test: every break in
  the three lists (BREAK_LISTS in scripts/break-it-lib.mjs) finds its text
  exactly once in its file. It skips itself inside a break-it run, where the
  break being judged has replaced its text. Six breaks had gone stale and
  were never tried (13.6 fees, 13.6 posted and arrived descriptions, 4.9
  always-do-this from savings, [activity] 5.2 and 4.7); each is pointed at
  the code again with the same mistake, and all six are caught. When code
  moves, the test names the breaks to point again.
- Phase 4, step 6, Settings and the change log: built Oct 9, 2026 on branch
  phase-4-settings, on made-up data only. Then stop, for his feedback.
  - Settings (packages/web/src/screens/Settings.tsx, the words in
    settings-text.ts; packages/server/src/views/settings.ts): every setting in
    rulebook section 2 but the bank rules (A23), each with a sheet to change
    it; the sorting rules by kind, numbered, with add, change, and remove;
    the payoff countdown (9.5), on once a promo end date is entered (the demo's
    is made up); the change log (13.5), newest first; and the same "totals do
    not match the bank" banner as Home and Buckets.
  - 13.1: a table of this pay period's split and mom reserve next to the next
    paycheck's, with "Changes" on what differs. The book gives out what is in
    force (Book.splitInForce, which it always kept for other income); which
    settings wait is FROM_NEXT_PAYCHECK in the money package. A24 asks if
    that is enough.
  - The money math checks and applies every change. New in the money
    package: Book.splitInForce; the settings-changed log line keeps what each
    setting was before; Book.previewSettingsChange (A9: what a new paycheck
    rule or mom rule would do to what is waiting, worked out by making the
    change and undoing it in full, so it is exactly what the change does);
    changeSettings returns what it handled; RULE_CHOICES (what each kind of
    rule can pick); a setting that does not exist is refused; a split that
    does not add up says what it adds up to.
  - Taps go through the same desk and the same address, POST /api/choice,
    with decision numbers: { settings } and { rule: { add | change | remove } }
    (choices.ts: ChoiceDesk.settings and ChoiceDesk.rule, parsed strictly).
    The screens still write only /api/seen and /api/choice (read-only.test.ts
    unchanged). The numbers are read from GET /api/settings, like every other
    screen. Only the settings that change are changed and logged; the same
    value again says "That is already the setting" (B114).
  - What asks first: the paycheck rule and the mom rule (set, changed, or
    cleared), with the money math's preview, and removing a rule (B112). His
    yes carries the key of the preview he saw; if what it would do has
    changed since, it asks again with the new one (B113).
  - Shared blocks added: CompareTable (two columns side by side; with a large
    text size each row stacks, by a container query in em), the "Changes"
    status, and TextField for whole numbers, dates, and times. The sheet is
    made anew on each opening, so it opens, filled in, in the same step as
    the tap.
  - Demo lives added: settings-busy (changes along the way, a new split
    waiting, a made-up promo end date, every kind of log line) and
    settings-first-sync (no paycheck rule or mom rule yet; the paycheck and
    a payment to mom waiting). Worked examples: money 32 and 33, screens 16
    and 17. npm run screenshots -- --only settings takes only the Settings
    pictures.
  - Tests: money 13-settings.test.ts (with 300 random books: the preview
    changes nothing and is exactly what the change does, and no cent is made
    or lost); server choices-settings, views-settings, http-settings, demo;
    web settings-text; browser settings (every setting shown against the
    book, every change against a twin), design-settings (contrast light and
    dark, 44-point taps, the notch and home bar, text size, reduced motion,
    money format, words not color), random-lives-settings (random lives,
    random changes, some refused, against a twin), worked examples 16 and 17.
  - Break-it: the new breaks are tagged "[settings]"; the screen's are
    section "home" (browser tests), the words' section "settings". Only the
    sections changed were run, in parallel; the screen's in Chromium
    (BROWSER_ENGINE=chromium). Edits in this chunk made 10 older breaks stale;
    the new test named them, and each was pointed at the code again.
  - His review of PR #13 (Oct 9): one money bug, his answers to A21 to A24
    (rulebook section 24, with his OK), and the Card reminders arrow. All on
    the same branch and pull request.
    - The bug (B124): setting the mom rule while a payment to her waited,
      partly refunded, paid mom from what the bank first sent and lost the
      refund. Book.#recheckForMom now leaves such a payment waiting exactly as
      it was and names it: RecheckedItem 'still-waiting', in the preview, the
      answer, and on Settings. Worked example 34. The random preview test now
      refunds some waiting payments (it finds the bug on its own with the fix
      off). Looked for the same mistake wherever a waiting item is taken out
      and made again from what the bank first sent; none other (B124).
    - The simulated life now clears the mom rule now and then and sets it
      again a few days later, while payments to mom wait (some refunded by
      the bank meanwhile), and clears the paycheck rule on a payday morning
      and sets it that evening. It works out from the rulebook what setting
      the rule must do, and checks the preview, the change, the buckets and
      the month's mom total. 400 lives of 5 years passed (1,553 mom rules and
      2,052 paycheck rules set again while things waited).
    - A21 (B123): "It was not a payment to the old card" (SortChoice
      { unmark: true }, ReviewOptions.unmark), only for a payment marked from
      savings, in review and on its bucket's list; it restores what the bank
      sent. Such a payment now takes exactly savings, needs, or this (the book
      used to take wants or a split for it quietly; a test found it). Demo
      life: review-marked-savings. Worked example 35.
    - A22 (B122): Book.moveRule(id, 'up' | 'down', date) moves a rule one place
      among the rules of its kind, logs 'rule-moved' (with the rule it passed
      and its place now), and sorts what waits that either rule now matches
      first. The desk takes { rule: { move: { id, direction } } }; Settings
      has Move up and Move down on the rule's sheet. Worked example 36.
    - Card reminders: the days are now on the row's second line, so its arrow
      stays on the row; a design test checks every arrow on Settings sits at
      the right edge of its row.
    - Break-it: new breaks tagged "[a21]" and "[a22]", and the bug's under
      "[settings]". Only the sections changed were run.
    - CI on PR #13 (Oct 9): the Windows job failed once in buckets.test.ts,
      "8.2 exactly the low end and exactly the high end are both within"
      (Chromium, net::ERR_NO_BUFFER_SPACE: Windows ran out of socket buffer
      space). A test not touched in this chunk, so it was rerun once, unchanged.
      On the rerun two others failed on Windows: this chunk's own
      design-settings "loading state" test (it left Home while Home's slow
      numbers were on their way; it now waits for them first, as openScenario
      does), and review.test.ts "5.6 5.2 each 'transfer between my accounts'
      row says what it does: to the old card from checking comes out of
      needs" (Chromium, a timeout waiting for the notice; not touched, left
      as is).
  - PR #13 merged (Oct 9, 2026).
- Browser tests failing on CI for no reason (Oct 9, 2026, branch
  ci-flaky-browser-tests). 5 of 8 CI attempts on PRs 11 to 13 had failed in
  browser tests the change had not touched. Only the browser tests' helpers
  and their tests changed (packages/web/test), not the app and not .github.
  - What the CI machines are (measured on them, Oct 9): 2 cores, 8 GB, one
    test file at a time. The same code runs up to 45% slower on one runner
    than another. Windows: 16,384 ports for outgoing connections (about
    16,150 usable), and a closed connection keeps its port for 121 s. Linux
    reuses those ports on 127.0.0.1. This PC is not like them: 16 threads,
    64,511 ports, and 30 s (it was tuned), so it is hard to make CI's
    failures happen here.
  - Found: page-quiet.test.ts checked that Home's request was answered by
    counting Playwright's "request finished" events right after the helper
    returned. Those events can arrive after the page has moved on, so it
    failed for that alone (Linux WebKit: asked 2, answered 1; Windows
    Chromium: asked 1, answered 0). It now reads what the page has had
    answered in full from the browser's own record (Resource Timing).
  - Found in the helpers: the in-page count of fetches on their way was added
    without waiting (void page.addInitScript) right before the page opened,
    so a page could open with nothing counting and untilAnswered would wait
    15 s for nothing; it counted a fetch as answered when its headers came,
    not its body; and untilQuiet decided from Playwright's events, so it
    could return while the screen was about to ask again, and the close that
    followed cancelled that request. Now: the count is put on each context
    before it has a page (watchContext; launch(engine) does it for every
    context of every browser the tests start), an answer counts once its
    body is in, untilQuiet and untilAnswered wait on the count inside the
    page, and a page with no count is said at once.
  - Leaving a page with a request on its way cancels it, and the browsers
    then sometimes lose the next request (Oct 7, Oct 8 twice). The two Linux
    failures (untilAnswered timing out in openLive in
    random-lives-activity) and a Linux WebKit page that never loaded in
    buckets.test.ts (Oct 8) each came on the page opened right after a
    close. The tests used to guard against it one at a time. Now a launched
    browser's contexts never close, go to another address, reload, or go
    back while the page has a request of its own on its way
    (leaveOnlyWhenQuiet in harness.ts). It costs about 4 s of 154 here. A
    test that holds a request on purpose must let it go before it leaves.
  - Ruled out: running out of ports with Connection: close. The most the
    tests ever had waiting for their port to be freed was 1,165 on Windows
    (938 on Linux), against about 16,000; and running out gives EADDRINUSE,
    not ERR_NO_BUFFER_SPACE. Keeping connections open instead passed on both
    (215 waiting on Windows), but Connection: close stays: it is what keeps
    WebKit from reusing a connection it had cancelled, and nothing showed it
    doing harm.
  - Not explained: the one net::ERR_NO_BUFFER_SPACE (Windows, Chromium, the
    first connection to a new test server, right after the test closed the
    last one), and two Windows Chromium screens that showed their error
    state (Home without its card, Review without its notice), which is what
    a request failing outright looks like. If it happens again, the report
    says more: when a browser test fails, every page still open is reported
    (what it shows, its requests on their way, what failed, its console, what
    its server was asked and answered) with the machine's connections on
    127.0.0.1 by state.
  - Found on this PC, not CI: a test server was given port 3659, which
    browsers refuse to open (their lists of such ports all end at 10080), and
    every test on it failed with net::ERR_UNSAFE_PORT. This PC hands out
    ports from 1024 up, one after another; CI starts at 32768 or 49152. A
    test server given such a port now listens again (listen in harness.ts;
    test/test-server.test.ts).
  - Tests: page-quiet.test.ts (22, both engines), test-server.test.ts.
    Break-it: 9 breaks of the helpers, tagged "[ci]", all caught (node
    scripts/break-it.mjs --match "\[ci\]" --only
    test/browser/page-quiet.test.ts for the 8 in section home; node
    scripts/break-it.mjs ci for the port).
  - PR #14 merged (Oct 9, 2026).
- Phase 4, step 7, the Setup day screens: built Oct 9, 2026 on branch
  phase-4-setup-day, on made-up data only (rulebook section 14 with A10,
  B42, B43, B48, B64). Then stop, for his feedback. Its own first commit:
  CI runs Linux only on pull requests, Windows by hand (see CI above).
  - The setup logic works on the bank history handed to it
    (packages/server/src/setup-history.ts: BankHistory, halvesInTransitIn,
    setupPreviewOf, planSetup, bankRuleOf, notReadyWhy). It reads nothing
    and saves nothing; setup-day.ts is the thin database wrapper (same
    exports as before, every older test passes untouched). StoredAccount
    moved to bank/stored-account.ts so nothing the demo loads touches db/.
  - Money: inTransitEffect (B48), startingDebt (12.4, A10), checkAssignment
    (what is left to assign), nextPayday (11.2, the book uses it too), and
    startTracking refuses a last paycheck after setup day (B42).
  - The setup desk (src/setup-desk.ts) keeps his answers until tracking
    starts: each half on its way or not, the last paycheck, an amount per
    bucket or "the rest" (worked out by the money math). Through POST
    /api/choice ({ setup: ... }, parsed strictly in choices.ts), with
    decision numbers. Starting asks first and the yes names the last look's
    key (like B113); it is refused unless every half is answered, the date
    is in, it adds up to the cent and the self-check passes; then never
    again. The screens' numbers come from GET /api/setup (setup-view.ts
    builds them; views/setup.ts has only the types the phone shares). The
    screens still write only /api/seen and /api/choice.
  - Screens: packages/web/src/screens/Setup.tsx (words in setup-text.ts),
    /setup/bank, transfers, paycheck, assign, check (SETUP_PATHS on the
    server, SETUP_ROUTES on the phone, their own lists). Home before setup
    day has "Start setup day"; after it, Needs attention says what is still
    to set (the paycheck rule and the mom rule) with a way to Settings
    (B130). New shared block: LinkButton.
  - Demo: SETUP_SCENARIOS, kept apart from the other lives (each has a
    made-up bank history, src/demo/made-up-bank.ts and setup-lives.ts, not a
    book): setup-day (charges pending on four accounts, a refund pending, a
    card payment on its way, money that landed first, a payment to the old
    card on its way) and setup-owes-more (starting money -1,756.47).
    demoSetupDesk makes a life's desk; tests make their twin with it. The
    demo still never loads the database (its import guard lists the new
    files). How far back halves are asked about is 10 days, fixed in the
    demo, until A25 is answered.
  - Tests: money 14-setup-day-screens (with 1,000 random banks and
    assignments); server setup-history (the pure logic and the database
    agree), setup-desk, views-setup, setup-random (300 random banks, the
    starting money worked out by hand in the test), demo-setup,
    views-home-still-to-set; browser setup, design-setup, random-setup
    (random banks through the screens, WEB_LIVES), worked-examples-setup.
    Worked examples: money 37 and 38, screens 18 and 19.
  - Break-it: new breaks tagged "[setup]" (money sections 11 and 14, server
    section "setup", screens section "home"); 17 older breaks whose code
    moved were pointed at it again.
- PR #15 merged (Oct 9, 2026).
- His answers to A25 and A26, and bank rules (Step 1 of the chunk): built
  Oct 9, 2026 on branch bank-rules, one pull request, on made-up data only.
  Then stop, for his feedback.
  - Its own first commit: A25 (Setup day looks back 10 days, a setting
    changed on the transfers step) and A26 (a purchase or payment waiting in
    review and refunded in full leaves review by itself, and comes back if
    the bank takes the refund back), in the rulebook (draft 13, section 25)
    and built test first. The simulated life covers A26 (online orders left
    unsorted while they go back; refunds taken back; nothing waits at
    $0.00). It also found a gap in the simulator itself (seed 233), now a
    test. The bank rule sentence says "a transfer between checking and the
    everyday card".
  - What the test bank really labels each item with was checked first
    (live/labels.live.ts, saved as test/fixtures/test-bank-labels.json):
    Plaid's personal_finance_category. Only labels seen there suggest rules.
  - The logic works on the bank items handed to it (packages/server/src/
    bank-rules.ts: bankLinesOf, suggestBankRules, matchesOf, changeBankRules,
    bankRuleProblem); bank-rules-db.ts is the thin database wrapper (rules,
    change log lines, items). The desk (bank-rules-desk.ts) keeps the rules,
    the log and the decision numbers in memory for the demo. Every change
    asks first with what the rule would have matched in the last 90 days;
    the yes names that preview. Types the phone shares: views/bank-rules.ts.
  - Setup day has a new step 2, Bank rules (/setup/rules): suggestions from
    the labels, each added, changed first, or skipped (SetupDesk, step
    { suggestion }), and the rules to change. Tracking does not start while
    one is open. Before tracking starts every step reads the history with
    the rules as they are now; a change drops answers about transfers it no
    longer asks about. After it, the same rules are on Settings (card "Bank
    rules": add, change, remove; remove asks first), and each change is in
    the change log among the book's lines, in the order made
    (SettingsInput.bankRules; BankRuleLogLine.afterBookLines).
  - Taps go through POST /api/choice: { bankRule: add | change | remove }
    and { setup: { suggestion } }, parsed strictly, with decision numbers.
    The screens still write only /api/seen and /api/choice. Shared pieces:
    screens/bank-rules.tsx (list, matches, the sheet) and bank-rules-text.ts.
  - Demo: the life setup-suggest starts with no bank rules (labels on its
    made-up bank); setup-day starts with them set. Tracked lives have five
    made-up bank rules, matched against what their made-up bank sent
    (scenarios.ts madeUpFeed, made-up-bank.ts madeUpLines).
  - Tests: server bank-rules (with the test bank's real labels),
    bank-rules-desk, setup-bank-rules, views-settings-bank-rules,
    bank-rules-db (the database and the logic agree; random histories with
    random rules changing between syncs: nothing already read changes, and
    the self-check passes after every sync; BANK_RULE_SCENARIOS=n, SEED=n;
    300 passed); web bank-rules-text; browser bank-rules (Setup day and
    Settings against a twin), design-setup and design-settings (the new step
    and sheets). Worked examples: money 39, bank 4, screens 18 (a new line).
  - Found while building it: the bank rule sheet on Settings and the
    settings sheet beside it had the same React key, so Close did not close
    it. The browser test caught it; a break keeps it caught.
  - Break-it: new breaks tagged "[a25]", "[a26]" and "[bank-rules]"; older
    breaks whose code moved were pointed at it again.
  - QUESTIONS.md A27 (two bank rules that match one item) waits on his
    answer; built as the first in the list wins, as it always was.
- PR #16 merged (Oct 9, 2026).
- Step 0 of the next chunk (Oct 9, 2026, branch real-server-keeps-everything,
  its own commit):
  - A27 option 1 (rulebook draft 14, section 2 and 26a): the first bank rule
    that fits wins; a bank rule moves one place up or down among the rules on
    its account (only they can fit the same item), on Settings and on Setup
    day. A move asks first with how many items from the last 90 days would
    change hands (itemsReadDifferently, BankRulePreview.move), and is logged
    (bank-rule-moved). B146 to B148. Worked example bank 5. Breaks "[a27]".
  - CI split in three jobs (above).
  - The WebKit contrast checks that went past 60 s with the whole suite
    running are split into smaller tests checking exactly the same pages:
    Buckets and Review (by screen and sheets), the bucket lists and Payday,
    Settings and Setup day (states and sheets), each per colour scheme. No
    limit raised. The bank rules browser test counted the rules on Settings
    before WebKit had drawn them; it now waits for the list.
- Step 1, the real server keeps everything (Oct 9, 2026, same branch): no
  login yet, this computer only, the test bank only.
  - The book's history (table book_events, database step 2): what the bank
    sent, setup day, and every answer of his ("answer" events), in the order
    it happened, each with the day it was made on and the totals after it.
    An answer is the book's own calls, written down by a recording wrapper
    around the live book (history/history.ts, recorderOf), with the dates
    inside them; Setup day answers before tracking, bank rule changes (also
    kept in the settings table and change log) and take-backs marked seen are
    parts of an answer event too. loadBook replays it all (history-db.ts,
    replayHistory); replaying never asks the clock.
  - Decision numbers (table decisions): the number, the request written the
    same way whatever its key order, the first answer, and its event, saved
    in the same transaction as the event. A refusal keeps nothing.
  - The replay check: totals = every bucket, unsorted in and out, the old
    card debt, money in transit, how many wait. The books do not open if any
    event replays differently (HistoryDoesNotReplay names the event); events
    saved before step 2 get their totals the first time they replay.
  - history/keeper.ts (Keeper): the real server's state rebuilt from the
    database (the book, the take-backs seen, Setup day answers, bank rules),
    the same desks as the demo (ChoiceDesk, SetupDesk, BankRulesDesk, which
    now start from saved answers and a saved log), each answer saved in one
    transaction; a save that fails reads everything again. Keeper.server()
    serves the screens. last_checked keeps Home's last backed-up safe to
    spend (0.5, B82).
  - Today comes from the home time zone (a setting, America/New_York to
    start; rulebook section 2 and 26b; history/today.ts todayIn and timeIn),
    on Settings (US zones). The money package only keeps it (Settings
    .homeTimeZone, checked to be a zone name): the one change there.
  - npm run serve (scripts/serve.mjs, src/serve): the real server, apart from
    the demo. data/budget.sqlite by default (--db), 127.0.0.1 only, the
    sandbox lock, --connect (the test bank with made-up accounts like his,
    src/serve/test-bank.ts), --sync. It needs BANK_TOKEN_KEY in .env (not
    filled in yet on his PC). The demo still never opens the database (its
    import guard lists history/history.ts, which is the money math only).
  - Tests: today (midnight, both clock changes, the server's own zone),
    database (step 2), history (recording, replay), history-check (totals,
    a rule changed on purpose with a spy, the clock never asked, dates,
    time zone, last checked), keeper (a busy life: after every step a fresh
    copy from the database equals the running one, screen by screen; real
    restarts; decision numbers; a save stopped halfway), keeper-random
    (random activity and answers, one copy restarted at random moments;
    KEEPER_SCENARIOS, SEED; 300 passed), simulated-life-restarts (the
    simulated life with every answer, the history in a file, restarted every
    simulated day, every bucket the simulator's own; SIM_DB_SEEDS,
    SIM_DB_FIRST_SEED, SIM_DB_YEARS), serve, and the browser test
    real-server (restarted mid pay period, every screen the same). The
    simulator's recorder now also reports each answer and every bucket at
    the end of each day (test code only). Worked examples bank 6 and 7.
  - Break-it: new breaks tagged "[keeper]" and "[zone]" (server section
    "history").
- Next chunk, branch login-and-sync-timer (Oct 10, 2026), one pull request.
  - Step 0, its own commit. The repo check (it is public): no .env, keys,
    tokens or account numbers in any of the 146 commits, the commit
    messages, or the PR text; his name (CLAUDE.md, his commits) and the old
    card's rough balance (rulebook section 1) are in it, and he said carry
    on. B92: Setup day's buttons stay off after an answer went through until
    the numbers asked for after it are shown (useSender in Setup.tsx); the
    double tap test runs in WebKit again, and a new test holds those numbers
    at exactly that moment. The Review contrast and tap target checks: one
    small test per sheet (design-screens.test.ts REVIEW_SHEETS), each
    checked where it stands. Found doing it: axe gave up on the lower text
    of every sheet ("could not be checked": it does not know the top layer
    and took the tab bar for something on top). axeViolations
    (design-helpers.ts) now hides what is under an open sheet, checks a
    pinned notice in its place (its background must be solid), and counts
    "could not be checked" as a problem; its own tests are
    design-helpers.test.ts. Breaks "[b92]", "[review-sheets]", "[contrast]".
  - Step 1, his answers to A28 and A29 (rulebook draft 15: 0.6, 4.5, 6.1,
    section 27).
    - A28: npm run replay-check (scripts/replay-check.mjs; the server's
      commands are built by scripts/server-build.mjs). history/retotal.ts
      (checkRetotal, acceptRetotal) and history/replay-check-command.ts (what
      it prints and asks). The yes names the list it was shown; the new
      totals and the change log line are saved in one step. The server's
      own change log lines (server-log.ts, the type in views/server-log.ts)
      sit in the change_log table like the bank rules' lines; Settings puts
      all three in order (afterBookLines, afterBankLines). An event the code
      refuses now cannot be fixed with new totals: QUESTIONS.md A30, built
      as option 1. replayEach in history-db.ts; replaying without the check
      works out no totals (doing so made every replay quadratic; the
      simulated life went from seconds to past ten minutes).
    - A29: money in to checking lists its likely purchases on checking
      (Book #likelyFor); matched, it becomes that refund (#matchRefund).
      Review says "A refund to your debit card?" over the list. Demo life
      review-debit-refund. Worked examples money 40, bank 8.
    - Breaks "[a28]", "[a29]"; six older breaks pointed at the code again.
  - Step 2, passkey login (Oct 10, 2026; this computer only, the phone comes
    with hosting in Phase 6). Library: SimpleWebAuthn (@simplewebauthn/server
    14.0.3, @simplewebauthn/browser 14.0.0): every passkey check is its.
    - packages/server/src/auth: auth.ts (Auth: one-time codes, making and
      using passkeys, logins, log out, the stay-logged-in setting),
      auth-db.ts (tables passkeys, sessions, login_codes: database step 3;
      logins and codes kept only as hashes), http.ts (the login's own
      addresses), device.ts (a device in words). Login lines go in the
      change log through server-log.ts.
    - http/server.ts: ROUTES (every address, with whether it needs a login),
      AUTH_ROUTES, LOGIN_PATH, and the Gate: with one (the real server, from
      Keeper.server(webRoot, origin)), every screen and /api address needs a
      login; every POST must carry the app's own Origin; a request to another
      host name is refused (127.0.0.1 is sent to localhost). Without one (the
      demo), no login, as before.
    - The cookie budget-login: HttpOnly, SameSite=Strict, Path=/, Max-Age the
      setting (30 days to start; rulebook section 2, 27c); Secure once the
      address is https. The code: 12 digits, good once for 15 minutes, only
      the newest, void after 10 wrong tries; npm run serve prints one when
      there is no passkey; npm run login-code prints one any time.
    - Phone: screens/Login.tsx (the login page), screens/login-card.tsx (the
      Login card on Settings: stay logged in, passkeys, add one (asks first),
      log out), api.ts authState and authSend (read-only.test.ts lists them),
      a 401 sends a screen to /login.
    - Tests: server auth.test.ts (with a passkey made in software,
      test/soft-passkey.ts), login-guard.test.ts (every route refused with no
      login, an expired one, and one from another database; Origin; host;
      no way in but a passkey), device.test.ts, database step 3; browser
      login.test.ts (Chromium, a virtual passkey: the first code to Home, log
      out, log in again). The tests' only way in is test/login-for-tests.ts,
      which writes a login into the test's own database (real-server.test.ts
      uses it); the guard test checks nothing in the server loads it.
    - QUESTIONS.md B160 to B166.
  - Step 2's follow-ups (Oct 10, a second session, same branch).
    - Break-it "[login]": 37 server breaks (section "login") and 4 on the
      screens. One survived at first: a login question answered twice was
      only caught by the passkey's use count, and Apple's passkeys always
      count 0; a test with such a passkey now catches it. New tests too: the
      5-minute limit on a login question, a login without Face ID or for
      another host, nothing kept in the clear, the gate refusing before the
      login's code is asked, and "10 wrong codes in a row" (B161: a good
      code typed in between now starts the count again; it did not).
    - CI's WebKit job failed on PR #18: login.test.ts always launched
      Chromium, which that job does not install. It runs only where Chromium
      is one of the engines now (describe.runIf).
    - Browser: login.test.ts also checks a screen whose login ended going to
      /login, a device logged in skipping the login page, and adding a
      passkey from Settings (it asks first). design-real-server.test.ts (both
      engines): the login page in every state, the Login card and its sheets,
      and Step 3's Checked at and Bank card. The loading page is checked with
      motion reduced: its skeleton shimmers forever, and atRest waits for
      every animation to end (it hung the test before).
  - Step 3, syncing on a timer and "Checked at" (Oct 10, same branch).
    Rulebook section 2 and 27d (his OK): sync with the bank every 60 minutes,
    a setting.
    - The timer: packages/server/src/serve/sync-timer.ts (SyncTimer, started
      by npm run serve once it listens; stopped, it lets a sync on its way
      finish). It only calls Keeper.sync, the same as --sync. Due one
      interval of real time after the last sync started (Keeper.syncDueIn);
      after a restart, after the last read; never read, at once; no bank
      connection, nothing. It sleeps at most a minute at a time. Nothing
      that goes wrong in it stops the server: it is logged, and it looks
      again later.
    - Database step 4: bank_reads (each read of the bank, with or without
      anything new, saved in the sync's own transaction: SyncInput.readAt).
      sync/bank-reads.ts: the last read, and the setting (settings table
      sync-every-minutes, 15 to 1,440, default 60). Keeper.changeSyncEvery
      logs a server line (sync-every-changed). POST /api/sync/every (logged
      in only; ROUTES; the phone's sendSyncEvery; read-only.test.ts lists it).
    - One at a time: Keeper.sync is the books' lock (a second caller gets the
      sync on its way). syncBank's afterSave runs right after the commit, in
      the same step, and the Keeper reads its books again there. Found doing
      it (a test first): before, the books were read again only after the
      sync's promise, so an answer arriving the instant a sync saved was
      saved against the old book, with totals that do not replay, and the
      server would not have started again (B172). After a sync the books
      are read again when it saved anything, or when the history has more
      than they have (another copy of the server saved a sync; Keeper
      lastSeq). Keeper's beforeCommit test hook reaches the sync's save too.
    - An answer about something a sync just changed (QUESTIONS.md A31, built
      as option 1, waiting on his answer): item-key.ts (itemKey, FNV-1a over
      what the item is: no Node, the phone's types read the views). Review
      and Payday items carry key, a bucket list has keys by row id; the
      phone sends it as seen (choose.tsx Target.seen); ChoiceDesk.decide
      refuses with code 'changed' and how it is now; the phone closes the
      sheet, says why, and asks for its numbers again.
    - Home: "Checked at 3:05 PM" (HomeView checkedAt, in his home time zone;
      ui/dates.ts checkedAtText), and "As of" in his home time zone too
      (HomeView timeZone). The demo shows a made-up time (9:41 AM; 7:15 AM
      when the bank cannot be read). Settings: the Bank card (sync-card.tsx),
      real server only, before setup day too.
    - Tests: server sync-timer (fake clock, test/fake-clock.ts: on time,
      restarts, Nov 1 2026 and Mar 14 2027, never two at once, a failed one
      saves nothing, 10.5, only the reading calls, the setting), sync-answers
      (A31 cases; an answer mid-read and at the moment of the commit),
      sync-answers-random (two servers, one restarted at random, a fresh copy
      from the database after every step; SYNC_ANSWER_SCENARIOS, SEED; 300
      passed), http-sync, views-home, database step 4; web format; browser
      home (Checked at), sync.test.ts (real server, both engines), review
      (the exact request now carries seen). Worked example bank 9.
    - Break-it: "[sync]" and "[a31]" (server section "sync", 43 breaks;
      screens section "home", 6), with the screens' "[login]" (4): every one
      caught. Two older breaks pointed at the code again ("[review]" an item
      already dealt with, "[keeper]" a save that did not go through).
    - QUESTIONS.md A31, B167 to B173; B154, B160, B161 brought up to date.
- PR #18 merged (Oct 10, 2026).
- Phase 4's finish line, branch phase-4-finish-line (Oct 10, 2026), one pull
  request.
  - Step 0, its own commit: his answers to A30 (option 1: rule 0.6) and A31
    (option 1, as built: new rule 13.7), rulebook draft 16, section 28. The
    A31 tests are named after 13.7.
  - Step 1, the full pay period through the screens, scripted.
    - The simulator can live a short life as planned (LifeOptions.plan in
      packages/money/test/sim/life.ts): planned bank events and answers
      instead of random ones, with every daily check. Without a plan nothing
      changes (40 lives gave byte-identical records before and after). The
      plan is packages/money/test/sim/pay-period.ts: setup day Oct 1 to the
      next payday Oct 16 (its header says what each day has). A refund the
      bank does not match is matched by hand in a planned life, as the bank
      connection reads every refund; money in to checking that is a refund
      is matched too (A29). Money test: pay-period.test.ts. Worked example
      41 is the same period by hand.
    - serveBooks (packages/server/src/serve/serving.ts): what npm run serve
      runs once the books are open (the screens behind the login, and the
      sync timer). main.ts uses it, and so do the tests. serving.test.ts.
    - The browser test, packages/web/test/browser/pay-period.test.ts (both
      engines, 34 tests each, run in order on one life; a failed part makes
      the later ones fail with its name): an empty database with the bank
      connected; the first code and a virtual passkey in Chromium
      (login-for-tests in WebKit); setup day through its screens; each day
      the bank's activity only by the sync timer (FakeClock); every answer of
      the simulated person tapped on the screens (Review, a bucket's list,
      Move, Settings, Payday); a tap refused because a sync changed the item
      (13.7); the take-back marked seen on Home; restarts after Oct 5 and
      Oct 12. Every day: every view the real server sends against the same
      views worked out from the simulator's book (pay-period/expected.ts;
      a difference names the day, the screen, the field and both numbers);
      every screen read off the page against the page given the simulator's
      numbers (pay-period/screens.ts, ShouldShow: a second page whose /api
      answers are the simulator's); and each screen's numbers read by what
      they are against the money math and the rulebook directly
      (pay-period/by-hand.ts). The self-check passes every day. Each day is
      two tests (its answers, then every screen), at most 13 s in WebKit on
      this PC. The simulator's book on any day is made again from what it
      recorded (pay-period/period.ts simulatorBookAt) and checked against the
      plain data saved from its own book that evening.
    - Found on Windows CI (Oct 10, Chromium): a page could not open,
      net::ERR_NO_BUFFER_SPACE, with about 3,000 connections on 127.0.0.1
      waiting to close (the most before was 1,165). The test opened the app
      afresh for every screen of every day on two pages; it now opens it once
      a day on each page (at Home) and moves between screens the way the
      app's own links do (readScreen with reload false: pushState and
      popstate, then the screen's title). Taps scroll their target to the
      middle of the screen first (screens.ts tap): a card's last button
      could sit under the tab bar, and Playwright's retry then stalled in
      WebKit on a busy PC.
    - Found by it: sim-bank.ts named a transfer's leaving half differently
      from the simulator's book; it now keeps the simulator's own words.
  - Step 2, the agent (agent-pay-period/): instructions.txt, script.txt (the
    pay period's bank activity and his decisions, in words), and the agent's
    notes.txt and report.txt, and settled.txt (how each point was settled).
    npm run pay-period-agent (scripts/pay-period-agent.mjs,
    test/browser/pay-period/agent-server.ts): the same real server and
    made-up bank on http://localhost:5390, a control page on 5391 ("Log this
    browser in", "Bring in the next day"). Every money number matched. Fixed
    from what it found (tests first): money on its way is listed on Buckets
    (12.5, B44: views/buckets.ts onItsWay, screens/buckets-text.ts, B174),
    and Payday and Home's sheet show what is on its way to savings (3.8, B46,
    views/payday.ts onItsWayToSavings, B175). Demo life: on-its-way. Breaks
    "[on-its-way]". QUESTIONS.md A32 and A33 from it, and B176.
  - Step 3, the end of Phase 4: test/every-rule-has-a-test.test.ts (every
    numbered rule has a test named after it), scripts/rule-table.mjs (the
    end-of-phase table from a full run's results), docs/phase-4-report.txt,
    and the list of part B items waiting for him at the top of part B.
  - Phase 4: finish line crossed Oct 10, 2026 (docs/phase-4-report.txt).
    npm test 3,221 tests, all passing. 1,000 simulated lives of 5 years and
    20 simulated years through the database with restarts, every check
    passing. The full break-it run: 1,101 breaks, 1,100 caught (7 h 36 min,
    8 workers, the browser tests in Chromium); the one that survived ("A18 a
    store refund is not known to be one") now has its test
    (resort.test.ts) and is caught, and so are the new breaks. Every break in
    the files changed after the full run started, run again on the final
    code: 62 breaks, 62 caught. PR #19; CI green on Linux.
- PR #19 merged (Oct 10, 2026).
- Phase 5, part one (alerts worked out and kept; no phone yet), branch
  phase-5-alerts-kept (Oct 10, 2026), one pull request (PR #20). Then stop,
  for his feedback.
  - Step 0, its own commit: A32 option 2 (13.7: a card that changed when the
    screen read its numbers again says "Changed: now $21.50, posted" and takes
    no tap for a second; useChoiceFlow keys in screens/choose.tsx, B178) and
    A33 option 3 (4.5: a word on most of his purchases on that account in the
    90 days up to the refund is not a name; likely-purchases.ts, B177).
    Breaks "[a32]" (10) and "[a33]" (7), all caught.
  - Step 1: packages/server/src/alerts (alerts.ts: facts, keys,
    words; plan.ts: which alerts are due when, the ledger, "alerts" events;
    outbox.ts), serve/alert-timer.ts (AlertTimer, the AlertSender plug,
    logSender for npm run serve), database step 5 (book_events takes kind
    "alerts"; the outbox table; migrate() turns foreign keys off for a step
    that makes a table again), history/today.ts instantIn, the Keeper
    (checkAlerts, the Alerter methods, alertsView, whenChanged; SyncBank.plan
    is a test seam), serveBooks makes the AlertTimer (main.ts starts it before the sync timer) and returns it as
    alerts, GET /api/alerts in ROUTES (the /alerts screen address joins
    SCREEN_PATHS with the web side). The simulator now records
    each day as steps (setup, each sync, each answer, the evening) with the
    alerts the server should send after each (DayStep, ExpectedAlert in
    packages/money/test/sim/life.ts), and checks card notices every evening
    for the latest statement of each card. Tests: alerts-plan, alert-timer,
    serving (a take-back alert at the sync moment), today, database step 5.
    Fake phone: packages/server/test/fake-phone.ts.
  - Step 1, finished (a second session, Oct 10):
    - The list in the app: /alerts (screens/Alerts.tsx, words in
      alerts-text.ts), from Settings' row "Alerts sent" (SettingsView alerts,
      real server only, like the Bank card), GET /api/alerts. Newest first,
      due and sent times, or why not sent yet. It only reads (read-only.test.ts
      unchanged). Browser test alerts.test.ts (both engines: the list against
      the outbox, every state, the design rules).
    - The take-back alert says "taken back Sat, Oct 3" (B184).
    - The Keeper keeps the bank's balances and statements between writes to
      the database (#bankNow, by total_changes() and data_version): the alert
      timer looks every minute. Database step 5 has the index outbox_unsent.
    - The simulated life through the real server (test/alerts-sim.ts, two
      files): the simulator's own transactions given to the book through the
      sync's test seam, the bank's items, balances and statements read from
      the made-up bank, his answers saved as answer events, and the server's
      own alert timer on a fake clock sending to a FakePhone. Every day: the
      outbox is exactly what the simulator expects (keys and due moments),
      everything sent, each shown once at its moment, and in the end the
      history's facts are the simulator's and there is one evening per day.
      alerts-simulated-life.test.ts: one server for 146 days from Oct 25 (seed
      188), the phone failing over some evenings, night syncs at 2:30 AM.
      alerts-simulated-life-restarts.test.ts: stopped every night and started
      every morning, 157 days from Oct 17 (seed 12), down over some evenings
      (sent at 9:30 PM, due 8:00 PM), syncs failing (tried again 5 minutes
      later), the bank wanting a login (alert "bank-login N"). Both cross Nov 1
      and Mar 14. ALERT_SIM_SEEDS, ALERT_SIM_FIRST_SEED, ALERT_SIM_YEARS,
      ALERT_SIM_ONE_SERVER_YEARS run more; ALERT_SIM_DEBUG=<file> writes each
      day's progress there.
    - alerts-random.test.ts: two servers, the same random activity, one
      restarted at random moments, also right after the phone got an alert
      and before it was marked sent, and with a save stopped halfway
      (ALERT_SCENARIOS, SEED). alerts-keeping.test.ts: the replay check covers
      alerts (one given twice, an evening twice), and outbox and history agree.
    - Worked examples bank 10 (a day's alerts with times), 11 (both sides of
      Nov 1), 12 (down over 8:00 PM).
    - Break-it: "[alerts]" and "[outbox]" (server sections "alerts" and
      "outbox"), the words' in web section "settings", the screen's in
      section "home". 45 breaks, all caught, judged by the alert tests only
      (--only alert, 3 workers: his PC was in use) and the 5 last by hand (the
      words by alerts-text, B182 by today, the screen by alerts.test.ts in
      Chromium). Two survived at first and now have tests: the outbox's next
      try (B181, alerts-keeping) and the list one more than it shows.
    - Found running it: each copy grew to 2 GB and filled his RAM (31 GB, 14
      copies). A query prepared afresh every minute holds native memory until
      it is collected; the hot ones are now prepared once per database
      (db/database.ts statement(), prepared-statements.test.ts): a simulated
      half year stays near 350 MB. With the long lives in it, break-it needs a
      smaller --workers or --only.
  - QUESTIONS.md A34 to A39 (built on the plain reading), B179 to B184.
- PR #20 merged (Oct 11, 2026).
- His answers to A34 to A39, and two browser tests that failed now and then:
  branch alerts-answers (Oct 11, 2026), one pull request. Then stop.
  - Step 0, its own commit: rulebook draft 18 (section 2, 9.7, 10.4, 10.5,
    10.7 to 10.10, section 30), QUESTIONS.md A34 to A39 answered, B185 to
    B191. There was no real database to convert (no data folder on his PC).
    - Three new settings, kept with the others in the money package's
      Settings (the money math only keeps them, like the home time zone):
      quietHours { from: '22:00', to: '07:00' } (the same time twice is
      none), bankNotReadAlertHours 24 (1 to 168), amountsOnLockScreen false.
      On Settings in "Alerts and reminders" (rows quiet-hours, not-read,
      lock-amounts), through the usual settings sheet and desk.
    - alerts/plan.ts: evenings that came while the server was not looking are
      one "alerts" event, check { kind: 'evening', from, date } (from only
      when more than one): the newest of each kind (one daily review, one
      card per card: reminder and overdue are one kind, the lasting repeats),
      only if still true now (a card: cardDue today, 9.6), each due at its
      own evening (10.9, A36). 10.4 and 10.5 repeat at the evening while they
      last, not twice on one day (facts day and again; key "... again
      <date>"; the ledger's lasting state has lastDay) (A37). 10.7 (A38):
      'bank-not-read', due at the last good read (bank_reads) plus the hours,
      cleared only by a newer read (lasting about). nextDueIn (was
      nextEveningIn) wakes the timer for it too.
    - alerts/sending.ts: quietUntil (10.8), dueWords ("Due 3:10 AM.", B185),
      wordsToSend (10.10). The Keeper sends nothing in quiet hours (toSend
      returns [], nextTryIn waits for their end), words without amounts
      unless the setting says so, and the due words when late. The outbox
      keeps each alert's facts (database step 6) so the words can be made
      when it is sent. The alerts list says "Waits for quiet hours to end at
      7:00 AM." (AlertLine quietUntil). OutgoingAlert has due.
    - alertWords(facts, { amounts }) (alerts.ts): words only for the lock
      screen; "still" on repeats; "The bank has not been read for 24 hours".
    - The simulated life through the real server (test/alerts-sim.ts) now
      also has, worked out from the rulebook with its own arithmetic (cards
      9.3 and 9.6, quiet hours): syncs in the night and a server back at 3:00
      AM (held for 7:00 AM, saying when due), the server down over 2 to 4
      evenings (one daily review, newest, still true), a login lasting days
      and a day the bank cannot be reached (the days' activity held back and
      read in order the next good morning, the not-read alert), the bank's
      balance drifting for days (FakePlaid drift: the mismatch once, then each
      evening), and no amount on the lock screen. A good day has a 9:00 PM
      sync, so a read is never a day old. Its own card arithmetic is checked
      against the simulator's on every normal evening.
    - today.ts keeps one date formatter per zone (making one is slow, and the
      timer asks every minute): example 11/12 went from 3 s to 0.5 s.
    - Tests: money 0-ground-rules; server alerts-plan (A34 to A39), alerts-
      sending (quiet hours and due words, pure and with the real books and
      the timer, the lock screen), alerts-random (quiet hours: the server
      restarted may lag only in quiet hours), choices-settings, database step
      6; web settings-text, alerts-text; browser settings, design-settings,
      random-lives-settings. Worked examples bank 13 (quiet hours) and 14
      (back after three evenings down).
    - Break-it: new breaks tagged "[a35]" to "[a39]" and "[b185]"; ten older
      ones pointed at the code again. All 88 of the changed sections' breaks
      without browsers caught, and the Settings screen's 3 (Chromium). Four
      survived at first and got tests: the quiet hours kept as a copy, a
      login repeat in the same look as the login was fixed, a longer
      not-read setting while it is told, and sending the moment quiet hours
      end (the timer's looks fell at :30 in the test). Two breaks made a
      timer fire for ever at one moment, which the test's own time limit
      could not stop (it is all promises): FakeClock now fails at once after
      1,000 timers at one moment (test/fake-clock.ts, fake-clock.test.ts).
- Waiting on: the promo end date for the old card (only the payoff countdown,
  rule 9.5, depends on it), and his check of part B (the list at its top).
