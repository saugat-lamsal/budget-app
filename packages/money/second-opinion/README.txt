SECOND-OPINION TESTS

Written from the rulebook (draft 6), CLAUDE.md, the roadmap, and the money
package's public type signatures (generated .d.ts files) only. The author did
not open the money source, the existing tests, the simulator,
worked-examples.txt or QUESTIONS.md while writing them (stage 1).

Every expected number is worked out by hand in a comment next to the test.
helpers.ts keeps a made-up bank next to the book so tests can also run the
self-check after each step.


RULEBOOK UNCLEAR (stage 1)

These are places where the rulebook did not say enough to write a test, so
no test guesses at them.

1. 3.3 rounding direction. "Leftover cents from rounding go to savings" does
   not say whether needs and wants are rounded down or to the nearest cent.
   Example: rest 100.03 -> needs 30.009 (30.00 or 30.01?). Tests only use
   amounts where both readings agree, plus a random test that needs and
   wants are within one cent of their exact share.

2. 3.4 and 3.5 together: what the leftover question asks about when a bucket
   is negative at payday. Tests assume nothing is "unspent", so nothing is
   asked or moved (3.5 says it carries over). If that is wrong, the 3.5
   "ask" test is the one to check.

3. 3.8 when the savings account already holds more than savings + reserve:
   is "still to move" negative, zero, or a move the other way? Not tested.

4. 4.1 "on the day of the purchase": which pay period a purchase counts in
   when it is dated before payday but arrives after it (matters for 10.1
   and 10.2). Not tested.

5. 4.5 a refund of a split purchase: which bucket(s) get it back, and in
   what proportion. Not tested.

6. 6.1 "this is my paycheck" chosen later: does the new pay period start on
   the deposit date or the day it was answered? Tests check only that a new
   period starts.

7. 9.1 / 9.3 "since the statement": does a payment on the closing date
   itself count? Not tested (tests use payments clearly before or after).

8. 9.3 / 9.4 payments that left checking but have not landed (CardPayment
   has a landedOn field). Do they count yet? Not tested.

9. 9.4 is the overdue alert sent once, or every day after the due date
   until paid? Tests check only the day after.

10. 9.5 rounding of balance / paychecks left, and whether a paycheck on the
    promo end date itself counts. Only "off with no date" and "on with a
    date" are tested.

11. 10.1 and 10.2 together: when a bucket drops straight from above the
    low level to zero or below, are both alerts sent or only the empty
    one? Tests filter by alert kind and do not decide this.

12. 10.1 rounding of the 20% level when it is not a whole cent (20% of
    189.99 = 37.998). Tests stay clear of that boundary.

13. 10.2 a bucket that starts the period already at zero or below: is the
    empty alert sent at once, on the first spend, or never? Not tested.

14. 10.3 "sent at the review time": the money package has no clock and
    takeAlerts has no time input, so the timing cannot be tested here
    (Phase 5). Only "only if something is unsorted" is tested.

15. 10.4 / 12.3 the sign of "the difference" (app minus bank, or bank minus
    app). Tests compare the size only.

16. 11.2 days to payday when the expected payday has passed and no paycheck
    has arrived yet. Not tested.

17. 12.5 a transfer whose arrival shows up before its departure (the card
    side posts first). Not tested.

18. 0.4 "read-only" is a property of the whole app (no calls that move
    money). Inside the money package the only testable part is that the
    app's own moves are bookkeeping and need no bank change.


STAGE 2 RESULTS (Oct 6, 2026)

170 tests, 169 pass, 1 fails. No money code or existing test was changed.

Group a (decided in QUESTIONS.md, rulebook lacks the wording): none.

Group b (rulebook unclear, nothing decides it): 1, left failing and marked.
  9.5 "on once the promo end date is entered". Rulebook 9.5 and section 16
  say the countdown works once the date is entered; the code keeps it off
  because the details are QUESTIONS.md A7, which is still open. Not a new
  question: A7 already has the options and a recommendation.

Group c (code disagrees with a clear rule): none.


The "rulebook unclear" list above, checked against QUESTIONS.md in stage 2:
  1  3.3 rounding direction ........ not in QUESTIONS.md
  2  negative bucket at payday ..... not in QUESTIONS.md (test passed:
                                      nothing asked, nothing moved)
  3  3.8 savings over-full ......... not in QUESTIONS.md (B46 is related)
  4  late-arriving purchase ........ B4 (open option, recommendation 2)
  5  refund of a split purchase .... A1 (open)
  6  period start date for 6.1 ..... B53 (deposit date)
  7  payment on the closing date ... B28 (does not count)
  8  payments not yet landed ....... B47
  9  overdue once or daily ......... B30 (every day until paid)
  10 9.5 details ................... A7 (open)
  11 low and empty at once ......... B58 (only empty)
  12 20% level rounding ............ B57 (exact, strictly below)
  13 starts at zero, empty alert ... B50 (alerts again at a new period)
  14 10.3 timing ................... B31 (Phase 5)
  15 sign of the difference ........ not in QUESTIONS.md
  16 payday passed, no paycheck .... B35 (days go negative)
  17 arrival seen before departure . B45 (negative in transit)
  18 0.4 read-only ................. not a money-package question
