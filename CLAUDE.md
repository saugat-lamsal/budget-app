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

- Rulebook: draft 14. Section 15 confirmed (a to j), section 17 changes
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
  his answers after bank rules (A27, and the home time zone: section 2).
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
- Waiting on: the promo end date for the old card (only the payoff countdown,
  rule 9.5, depends on it), and QUESTIONS.md A28 (what happens when the
  replay check finds a difference) and A29 (a store's refund to the debit
  card).
