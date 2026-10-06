# Budget App Roadmap

Each phase has a finish line. We do not start the next phase until the
current one crosses it. Sizes are rough guesses, not promises.


## Phase 0. Setup (small)

- Create the project and put the rulebook in it.
- TypeScript, with a test runner that runs everything with one command.
- Sign up for Plaid and get test-bank keys. No real accounts yet.

Finish line: one command runs the tests and they pass.


## Phase 1. The money math (large)

- Build the bucket math as its own piece: no screens, no bank, no database.
- Cover the rulebook: payday, spending, transfers, deposits, other people's
  money, mom, safe to spend, self-check, changes, setup day.
- All amounts in whole cents.
- At least one test per numbered rule, named after the rule (for example
  "4.6 pending charge counts once").

Finish line: every numbered rule has a passing test.


## Phase 2. Stress testing (medium)

- Simulated you: a script that invents a realistic money life and
  fast-forwards through it. Paychecks every two weeks, card swipes, pending
  charges that post later, refunds, split purchases, mom payments on random
  days, friends' cash in and out, card payments, three-paycheck months,
  settings changed mid-year.
- Random scenarios: thousands of made-up histories, each checked against
  rules that must always hold:
  - the paycheck parts add up to the paycheck exactly
  - nothing is counted twice
  - the self-check passes on every simulated day
  - a transfer between your own accounts never changes a bucket
- Second opinion: a separate AI agent writes its own tests from the rulebook
  without seeing the code. Any disagreement gets settled against the
  rulebook, and the rulebook gets clearer if it was vague.

Finish line: thousands of simulated years pass with zero self-check failures,
and both sets of tests pass.


## Phase 3. Bank connection, test bank only (medium)

- Connect to Plaid's test bank with made-up accounts and transactions.
- Pull transactions, balances, and credit card due dates into a database.
- Handle pending charges turning into posted ones.
- Store the bank access key encrypted, on the server only.

Finish line: test-bank activity flows in and the app's totals match the test
bank's balances.


## Phase 4. The screens (large)

- Login with a passkey or Face ID.
- Home: safe to spend, days to payday, anything needing attention.
- Buckets: what is left in each, mom reserve, held for others.
- Daily review: one tap per unsorted item, with "always do this".
- Payday: move-to-savings amount and the leftover choice.
- Settings: every number and rule, plus the change log.
- Setup day.
- An AI agent uses the app in a browser like a person would and checks that
  what the screens show matches the money math.

Finish line: an agent completes a full simulated pay period through the
screens and every number matches.


## Phase 5. Reminders and alerts (medium)

- Phone notifications from the home-screen app.
- Card reminders, low and empty bucket, daily review, self-check mismatch,
  bank needs re-login.
- Tested with a fake clock so we can jump to any date.

Finish line: in simulation, every alert fires at the right time, once, and
never when it should not.


## Phase 6. Security check and hosting (small)

- Pick hosting and put the app online.
- Confirm: bank key encrypted, no secrets in the phone app, login required
  on every screen, backups on, nothing sensitive in logs.

Finish line: the checklist passes and the app works on your iPhone against
the test bank.


## Phase 7. Trial on your real accounts (about a month)

- Connect Bank of America (uses 1 of your 10 slots).
- Do setup day with real balances.
- Run for two pay periods. Once a week, compare the app to your statements.
- Any mismatch becomes a new test before it gets fixed.
- Keep a copy of the real history, with names removed, as a permanent test
  that every future change must pass.

Finish line: 30 days in a row with no self-check mismatches and no surprises
against your statements.


## Phase 8. Live

- You rely on the alerts and numbers day to day.
- The daily self-check stays on for good.
- Later, if you want them: charts, subscription spotting, savings goals.


## Waiting on

- Promo end date for the old card. Needed for the payoff countdown only.
