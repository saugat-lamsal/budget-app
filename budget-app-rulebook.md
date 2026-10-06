# Budget App Rulebook (draft 5)

This is how the app treats every kind of money movement. Each rule has a
number so a test can point at it. Nothing gets coded until you approve this.


## 0. Ground rules

0.1  All amounts are stored in whole cents.
0.2  Every number and rule in this document is a setting you can change in
     the app. Nothing is hard-coded.
0.3  Changing a setting never rewrites a past pay period.
0.4  The app is read-only. It never moves money.
0.5  If the app's totals do not match the bank, it says so instead of showing
     a number it cannot back up.


## 1. Accounts (all Bank of America, one connection)

- Checking (debit card)
- Savings
- Everyday card (the credit card you use normally)
- Old card (the house card, about $3,000, no longer used)


## 2. Settings and starting values

- Split: savings 50%, needs 30%, wants 20% (must add up to 100)
- Mom reserve: $1,500 per paycheck, capped at $3,000
- Mom monthly target: $2,000 to $3,000
- Low-bucket alert: 20% left
- Card reminders: 7 days and 2 days before the due date
- Daily review time: 8:00 PM
- Leftover at payday: ask each time (other options: always roll over,
  always move to savings)
- Old card promo end date: (you fill in)
- Paycheck rule: how your pay shows up on the statement (set after first sync)
- Pay schedule: every 14 days, counted from the last paycheck
- Mom rule: her name as it appears on transfers (you enter it in the app)


## 3. Payday

3.1  A deposit that matches the paycheck rule is a paycheck and starts a new
     pay period.
3.2  The mom reserve comes off first. If the reserve is already at its cap,
     the part that does not fit goes to savings instead.
3.3  The rest is split by the percentages. Any leftover cents from rounding
     go to savings, so the parts always add up to the paycheck exactly.
3.4  At each payday, unspent needs and unspent wants either roll over into
     the next pay period or move to savings. You choose for each bucket
     separately. Until you answer, the money stays where it is, and you can
     still move it by hand later (13.3).
3.5  An overspent bucket carries over as a negative, so the next period
     starts smaller.
3.6  A third paycheck in a month is handled exactly like any other.
3.7  A paycheck-looking deposit that arrives less than 10 days after the last
     one goes to review instead of splitting automatically.
3.8  On payday the app tells you how much should be sitting in the savings
     account (savings plus mom reserve) and how much you still need to move.


## 4. Spending

4.1  A purchase on the debit card or the everyday card comes out of a bucket
     on the day of the purchase.
4.2  The bucket is picked by your rules. No matching rule means "unsorted".
4.3  Unsorted spending is held back from safe-to-spend until you sort it.
4.4  A purchase can be split across buckets. The parts must add up to the
     total.
4.5  A refund goes back into the bucket the purchase came from. If the app
     cannot match it to a purchase, it goes to review.
4.6  A pending charge counts once. When it posts, the final charge replaces
     the pending one, even if the amount changed (a tip, for example).
4.7  Re-sorting a purchase updates the buckets right away.
4.8  Fees and interest on the everyday card go to review. Suggested bucket:
     needs.


## 5. Transfers and card payments

5.1  Checking to everyday card: not spending. The purchases were already
     counted under 4.1.
5.2  Checking to old card: spending. It comes out of needs, on a "debt
     payoff" line.
5.3  Checking to savings, or savings to checking: no bucket changes. The app
     only updates how much still needs to be moved (3.8).
5.4  A new purchase on the old card is flagged and sent to review. Like
     interest and fees (5.5), it raises the debt shown and touches a bucket
     only when you pay it (5.2).
5.5  Interest or fees on the old card raise the debt shown. They touch a
     bucket only when you pay them.


## 6. Deposits that are not a paycheck

6.1  They always go to review, with four choices:
     - This is my paycheck: starts a new pay period like any paycheck
       (3.1 to 3.5): the mom reserve first, then the split
     - Other income: split by the percentages only. No mom reserve is
       taken and no new pay period starts. The reserve comes only from
       paychecks.
     - Payback: goes into the bucket you pick
     - Not mine: goes to "held for others"
     A paycheck-looking deposit held back under 3.7 gets the same
     choices.
6.2  A rule can make the choice automatic for a known source.


## 7. Other people's money

7.1  A deposit marked "not mine" adds to "held for others". It is not income
     and is not split.
7.2  A payment out marked "not mine" lowers "held for others". It is not
     spending.
7.3  "Held for others" is shown as its own number and should return to zero.
     A negative number means someone owes you.
7.4  Payments to people go to the daily review unless there is a rule for
     that person.
7.5  A friend paying you back is a payback (6.1).


## 8. Mom

8.1  Any payment that matches the mom rule comes out of the mom reserve,
     whatever the day or amount.
8.2  The app shows how much you have sent this calendar month against the
     target.
8.3  If a payment is bigger than the reserve, the app asks which bucket
     covers the difference.
8.4  The reserve carries over between months, up to its cap (3.2).


## 9. Credit card reminders

9.1  Everyday card: reminders show the statement balance, the minimum, and
     the due date.
9.2  Old card: reminders show the minimum and the due date.
9.3  Everyday card: reminders continue until the payments the app sees
     since the statement add up to the full statement balance. Paying less
     usually means interest on the rest.
     Old card: reminders stop once the payments the app sees since the
     statement add up to at least the minimum.
9.4  If the due date passes with no payment seen, you get an overdue alert.
     On the old card, payments since the statement that add up to less
     than the minimum also leave it overdue.
9.5  Old card payoff countdown: balance divided by the paychecks left before
     the promo ends, counted from the pay schedule.


## 10. Alerts

10.1  Low bucket: needs or wants falls below the alert level. Once per bucket
      per pay period.
10.2  Empty bucket: needs or wants reaches zero or below. Once per bucket
      per pay period.
10.3  Daily review: sent at the review time, only if something is unsorted.
10.4  Totals do not match the bank (section 12).
10.5  Bank connection needs you to log in again.


## 11. Safe to spend

11.1  Safe to spend = wants left, minus unsorted spending.
11.2  It is shown with the number of days until the next payday, from the
      pay schedule.
11.3  Savings, mom reserve, held for others, and unsorted money in are never
      part of it.


## 12. Daily self-check

12.1  Bank side: checking + savings - everyday card balance, including
      pending charges (they already count in the buckets under 4.6).
12.2  App side: savings + needs + wants + mom reserve + held for others
      + unsorted money in - unsorted spending.
      Unsorted money in: deposits and refunds waiting in review
      (3.7, 4.5, 6.1).
12.3  The two must be equal. If not, the app shows a warning with the
      difference.
12.4  The old card balance is tracked separately as debt and is not part of
      this check.
12.5  Money in transit: a transfer that has left one of your accounts but not
      yet arrived in another (a card payment, usually) is shown as "in
      transit". The check is: bank side + in transit = app side. Money on its
      way to the old card is shown but not counted, because the old card is
      not part of this check (12.4). It comes out of needs when it leaves
      checking (5.2), and the debt goes down when it lands.


## 13. Changing things on the fly

13.1  A change to the split or the mom reserve applies from the next
      paycheck.
13.2  A new or changed sorting rule applies to new and unsorted transactions.
      Already-sorted ones stay put unless you re-sort them.
13.3  You can move money between buckets by hand at any time.
13.4  Moving money out of savings or the mom reserve asks you to confirm
      first. So does any move that would leave the bucket it comes out of
      below zero, since that is usually a typo.
13.5  Every change and every manual move is logged with the date.
13.6  When you correct something and choose "always do this", the new rule
      goes just ahead of the rule it corrects, so the correction sticks.
      The rule it corrects is the first rule in your list that matches the
      item, as it first showed up (often the pending description) or as it
      posted. If no rule matches it, the new rule goes at the end of your
      list.


## 14. Setup day

14.1  The app reads your current balances.
14.2  You assign the starting money (checking + savings - everyday card
      balance) across savings, needs, wants, mom reserve, and held for
      others.
14.3  The self-check must pass before tracking starts.


## 15. Choices confirmed (Oct 6, 2026)

a.  An overspent bucket carries over as a negative (3.5).
b.  Mom reserve carries over and is capped at $3,000, with overflow going to
    savings (3.2, 8.4).
c.  Old card payments come out of needs (5.2).
d.  Safe to spend counts wants only, not needs (11.1).
e.  Split changes start at the next paycheck, not mid-period (13.1).
f.  Taking money out of savings is allowed but asks you to confirm (13.4).
g.  Deposits and refunds waiting in review count in the self-check but not
    in safe to spend (12.2, 11.3).
h.  A new purchase on the old card raises the debt and touches needs only
    when you pay it (5.4).
i.  The bank side of the self-check includes pending charges (12.1).
j.  Paydays are every 14 days, counted from the last paycheck (section 2,
    9.5, 11.2).


## 16. Still needed from you

- The promo end date on the old card (you are checking). Until it is
  entered, the payoff countdown (9.5) stays off. Everything else works.


## 17. Changes after the Phase 1 review (Oct 6, 2026)

a.  Money in transit between your accounts is part of the self-check, so
    a card payment on its way does not show as a mismatch (12.5).
b.  A rule made from a correction beats the rule it corrects (13.6).
c.  The empty-bucket alert comes once per bucket per pay period, like the
    low-bucket alert (10.2).
d.  A hand move that would take any bucket below zero asks you to confirm
    first (13.4).
e.  Everyday card reminders continue until the full statement balance is
    paid. The old card stays at the minimum (9.3).


## 18. Answers to the Phase 1 questions (Oct 6, 2026)

a.  Money in from review: "this is my paycheck" starts a new pay period,
    with the mom reserve first and then the split. "Other income" is
    split by the percentages only: no mom reserve, no new pay period
    (6.1).
b.  Old card: payments since the statement add up. Reminders and the
    overdue alert stop once they total at least the minimum (9.3, 9.4).
