# Open questions from Phase 1

Two kinds of questions are listed here.

Part A: the rulebook does not say. Either the case is not built yet, or,
where money has to land somewhere to keep the totals right, it goes to
review so you decide each time. Each one has options and a recommendation.

Part B: the plain reading of the rule was built, but a reasonable person
could have meant something else. Each one says what the app does now.
Nothing to do unless one of them is wrong.


## Part A. Waiting on your answer

A1. ANSWERED Oct 6, built. A refund on a split purchase, or a split
    purchase that posts at a different amount (4.4 with 4.5 and 4.6).
    Your answer: a full refund goes back to each bucket as it was split,
    and nothing waits in review. A partial refund sends the purchase back
    to review with its new total, to be split again, as before. A split
    purchase that posts at a different amount also goes back to review, as
    before. Rulebook 4.5 and 18g updated.

A2. ANSWERED Oct 6, built. A pending charge that disappears without
    posting (4.6). Your answer, the recommendation: the charge is removed
    and its money goes back to where it came from. The bank connection
    reports it as a dropped charge. Rulebook 4.6 and 18k. Worked example 18.

A3. ANSWERED Oct 6. Spending to savings or the mom reserve (4.2, 4.4).
    Your answer, the recommendation: needs or wants only, as built. To
    pay for something out of savings, move the money by hand (13.3).
    Rulebook 4.2 and 18l.

A4. ANSWERED Oct 6, built. A payment to the old card from savings (5.2).
    Your answer: it comes out of the savings bucket once you confirm it,
    and when it asks you can pick needs instead. It waits in review with
    savings suggested. Rulebook 5.2 and 18m.

A5. ANSWERED Oct 6, built. Does "income" from review start a new pay
    period? (6.1 with 3.1, 3.7)
    Your answer: two choices instead of "income". "This is my paycheck"
    starts a new pay period: mom reserve first, then the split. "Other
    income" is split by the percentages only: no mom reserve taken, no
    new pay period. Rulebook 6.1 and 18a updated. Worked examples 7 and
    15. The readings I had to pick while building it are B52 to B55.

A6. ANSWERED Oct 6, built. Paying a card in more than one payment (9.3),
    and payments below the minimum (9.4).
    Your answers: on the old card, payments since the statement add up,
    and reminders and the overdue alert stop once they total at least the
    minimum (18b). The everyday card's overdue alert now works the same
    way (option 2, 18d). Its reminders still continue until the full
    statement balance is paid (9.3). Rulebook 9.3, 9.4, 18b and 18d
    updated.

A7. ANSWERED Oct 6, built. Old card payoff countdown (9.5).
    Your answer, the recommendation: a. the paydays left are the ones
    after today and before the promo end date, not on it; b. each share is
    rounded up to the cent, so the last payment comes out a little
    smaller; c. with no paydays left, the whole amount is due now; d. it
    divides the old card debt the app tracks (5.4, 5.5). Also: with nothing
    owed, $0 per payday. It stays off until you enter the promo end date
    (section 16). Rulebook 9.5 and 18e updated. Worked example 17. The
    reading I had to pick while building it is B59.

A8. ANSWERED Oct 6, built. Low bucket alert (10.1).
    Your answer: 20% of what the bucket started the pay period with,
    including rollover. If a bucket starts at zero or below, skip the low
    alert; the empty alert covers it. Rulebook 10.1, section 2 and 18c
    updated. Worked example 16. The readings I had to pick while building
    it are B56 to B58.

A9. ANSWERED Oct 6, built. Setting the paycheck rule or the mom rule
    after the first sync. Your answer, the recommendation: what is waiting
    in review is checked again, like 13.2. A waiting deposit that matches
    the paycheck rule becomes a paycheck, oldest first, still with the
    10-day check (3.7); one older than the last paycheck stays waiting as
    an early paycheck (B54). A waiting payment that matches the mom rule
    comes out of the mom reserve (8.1, 8.3). Rulebook 13.2 and 18n.

A10. ANSWERED Oct 6. Charges still pending on setup day (14.2 with 4.6).
     Your answer, the recommendation: as built. If one later posts at a
     different amount, is refunded, or is dropped, only the difference
     waits in review. Rulebook 14.2 and 18o. Worked example 13.


## Part A, added with Phase 3, the bank connection (Oct 7). All answered.

A11. ANSWERED Oct 7. Phase 3's finish line and the test bank.
     Your answer: option 1, the recommendation. Also added, at your
     question: the simulated you (Phase 2) through the bank connection, in
     Plaid's format, with the self-check passing every day
     (packages/server/test/simulated-life.test.ts).
     The finish line says the self-check passes against the test bank's
     balances once test-bank activity flows in. Plaid's test bank never
     moves an account's balance when transactions are added; Plaid's own
     docs say its test transactions "may show income and outflow
     inconsistent with the balance shown on the account". So:
     - On setup day the self-check passes against the test bank's real
       balances, pending charges included (checked live).
     - After new test-bank activity, the app's totals move by exactly what
       the activity says ($2,230.49 in the live run), and the self-check
       shows that same amount as the gap, because the test bank's balances
       stayed put. The app is right to say so (0.5).
     - With a made-up bank that does move its balances like a real one, the
       self-check passes after every sync: 400 random scenarios, a saved
       week worked through by hand, and the scenario tests.
     Option 1: accept these as Phase 3's finish line. The check with
     balances that really move comes in Phase 7, on your real accounts.
     Option 2: something else you have in mind.
     Recommendation: option 1.

A12. ANSWERED Oct 7, built. How the app tells your transfers, payments to
     people, and card fees from purchases.
     Your answer: option 2 on top of option 1. Bank rules (text the
     description contains, on one account) join the settings in rulebook
     section 2, and the setup screen in Phase 4 will also suggest rules from
     Plaid's own labels, for you to confirm. Also, at your request, review
     offers "transfer between my accounts" for anything the rules miss.
     Rulebook section 2, 5.6 and 20a. Worked example 22. The readings I had
     to pick while building it are B74 and B79.

A13. ANSWERED Oct 7, built. A pending charge whose amount changes while it
     is still pending.
     Your answer: option 2. The new amount counts right away, in the same
     bucket. Rulebook 4.6 and 20b. Worked example 19, and example 3 for the
     bank.

A14. ANSWERED Oct 7, built. The bank removing or changing a transaction the
     app already counted.
     Your answer: option 2, with a change log entry, and you are told when
     it happens. The app takes it back, and its money goes back where it
     came from. Rulebook 4.10, 10.6 and 20c. Worked example 21, and example
     3 for the bank. The readings I had to pick while building it are B71,
     B72, B75 to B77.

A15. ANSWERED Oct 7. Which purchase a refund belongs to (4.5).
     Your answer: option 1, always ask. In Phase 4, review lists the
     purchases a refund likely belongs to (added to the roadmap). Rulebook
     20d.

A16. ANSWERED Oct 7, built. Money leaving savings that is not a transfer to
     one of your accounts.
     Your answer: change it. A payment to a person is handled the same
     whichever of your accounts it leaves: a payment to mom from savings
     comes out of the mom reserve like any mom payment. Other money leaving
     savings goes to review with the normal choices. Rulebook 4.9, 7.4,
     8.1 and 20e. Worked example 20. The reading I had to pick while
     building it is B78.

## Part B. Built on the plain reading. Tell me if any is wrong.

B1. Paycheck smaller than the mom reserve (3.2).
    A $1,200 paycheck can only give the reserve $1,200, not $1,500. The
    whole paycheck goes to the reserve (up to the cap; any part that does
    not fit goes to savings), and nothing is left to split, so needs and
    wants get $0 that payday. Worked example 3.

B2. Leftover amount is fixed at payday (3.4).
    The question "roll over or move?" is about what was left in the bucket
    when the paycheck arrived. If you answer a few days later, that same
    amount moves, even if you have spent from the bucket since. Since your
    B4 answer, spending made before payday that shows up later does change
    it (B4, B70).

B3. A second payday before you answer the first leftover question (3.4).
    The old question is replaced by a new one covering everything now in
    the bucket (the old leftover plus anything unspent since). Answering
    both would otherwise move the same money twice.

B4. ANSWERED Oct 7, built. A purchase that shows up after payday but was
    made before it (3.4 with 4.1).
    Your answer: option 2. While the question is still open, it goes down
    by the late purchase, never below zero. Rulebook 3.4 and 20f. Worked
    example 24. The reading I had to pick while building it is B70.

B5. "Less than 10 days" (3.7) counts calendar days between the two dates.
    Exactly 10 days splits normally. A paycheck dated on or before the last
    one also goes to review. The 10 is a setting.

B6. A paycheck that lands in savings instead of checking is still a
    paycheck, as long as it matches the paycheck rule (3.1).

B7. A refund of a purchase you have not sorted yet lowers the unsorted
    spending. When you sort the purchase, only what is left of it goes to
    the bucket. Re-sorting a partly refunded purchase moves only what is
    left (4.5, 4.7).

B8. Which purchase a refund belongs to comes from the bank connection
    (Phase 3). A refund bigger than what is left of its purchase goes to
    review (4.5).

B9. A rule matches when the bank description contains its text, ignoring
    upper and lower case. If two rules match, the first one in your list
    wins (4.2).

B10. When a pending charge posts, it keeps the bucket it already had, even
     if the posted description would match a different rule (4.6). It also
     keeps the date you made the purchase (4.1).

B11. "The parts must add up to the total" (4.4) means what is left of the
     purchase after any refunds.

B12. Paying the everyday card from savings is treated like paying it from
     checking (5.1): not spending, no bucket changes.

B13. A refund on the old card lowers the debt and touches no bucket. It has
     to: the old card is outside the self-check (12.4), so moving a bucket
     would break it.

B14. Paying the old card more than it owes leaves a negative debt (a
     credit). The whole payment still comes out of needs (5.2).

B15. A pending old card purchase that posts at a new amount changes only
     the debt (5.4). It stays flagged until you have seen it.

B16. Updated after your A5 answer. A store refund the app cannot match
     (4.5) can be payback or not mine, but not "this is my paycheck" or
     "other income".

B17. Deposit rules (6.2) never apply to a paycheck. The paycheck rule is
     checked first, and an early paycheck (3.7) always goes to review.

B18. Updated after your A5 answer. "Other income" takes nothing for the
     mom reserve; it is only split by the percentages. "This is my
     paycheck" is a paycheck, so the reserve comes off first, up to its
     cap, even when the deposit is smaller than the reserve (B1). Worked
     examples 7 and 15.

B19. Updated after your A5 answer. A 3.7 early paycheck in review gets the
     same four choices as any other deposit. Rulebook 6.1 now says so.

B20. ANSWERED Oct 7, built. Your answer: "for mom" is also a review choice
     for payments to people (out of the mom reserve, counted toward the
     month), and a payment to a person can be split across needs, wants,
     and not mine. Rulebook 7.6 and 20g. Worked example 23. The reading I
     had to pick while building it is B73.

B21. A person rule matches the payee as the bank shows it, for example
     "ZELLE TO <name>" (7.4).

B22. Held for others (7.3) is shown with what it means: settled (zero),
     holding money for others (positive), or someone owes you (negative).
     Nothing nags you when it stays above or below zero; section 10 lists
     no alert for it.

B23. The difference on a mom payment (8.3) goes to one bucket, needs or
     wants. It cannot be split. Savings: see A3.

B24. "Carries over between months, up to its cap" (8.4): nothing happens
     at the start of a month. The cap limits what a paycheck adds (3.2).
     A reserve already above the cap, for example after you lower the
     cap, is not cut back; it just gets nothing more until it is under
     the cap.

B25. Same-day order. Things are applied in the order the bank sends them.
     If a paycheck and a mom payment land on the same day, the order
     changes how much of the reserve overflows to savings.

B26. Only payments to people (Zelle and the like) are checked against the
     mom rule (8.1). Since your B20 answer, any other payment to a person
     can be marked "for mom" in review (7.6).

B27. Updated after your A5 answer. Re-sorting money in can no longer pull
     the mom reserve below zero: other income never fills the reserve,
     and "this is my paycheck" cannot be re-sorted (B52). A hand move you
     confirm can still take it below zero (13.4). Whenever the reserve is
     at zero or below, a mom payment takes nothing from it and all of it
     waits in review (8.3).

B28. Card reminders go out exactly 7 and 2 days before the due date
     (calendar days; both are settings). A payment counts toward a
     statement when it reached the card after the statement date and left
     on or before today (9.1 to 9.3; see B47 for payments in two halves).
     Now in the rulebook (9.3).

B29. Updated with your review of 9.3. Everyday card: a statement with
     nothing owed (or a credit) gets no reminder; one with a balance but a
     $0 minimum still reminds until it is paid. Old card: a $0 minimum gets
     no reminder. Neither card gets an overdue alert when the minimum is
     $0, since nothing was due.

B30. Updated after your A6 answers. The overdue alert (9.4) is due on
     every day after the due date until the payments seen since the
     statement add up to at least the minimum, on either card. Making
     sure it reaches the phone once is Phase 5.
     Now in the rulebook (9.4).

B31. Changed after your review: see 10.2 in the rulebook. The empty-bucket
     alert now comes once per bucket per pay period. The book remembers
     which buckets it has already alerted about this pay period
     (takeAlerts). The other alerts come every time they are due; sending
     them at the right time is Phase 5.

B32. "Only if something is unsorted" (10.3) counts everything waiting in
     review: money in, spending, leftover questions, and old card flags.

B33. The bank login alert (10.5) follows the bank connection's status,
     which comes from Phase 3.

B34. Safe to spend (11.1) can go below zero when wants are overspent or
     unsorted spending is bigger than what is left in wants. It is shown
     as the negative number.

B35. Next payday (11.2) is the last paycheck plus 14 days. If that day
     passes with no paycheck, the days to payday go negative (the paycheck
     is late) instead of jumping ahead another 14 days.
     Now in the rulebook (11.2).

B36. Changed after your review: see 12.5 in the rulebook.
     The bank balances for the self-check still come from the bank
     connection with pending charges included (12.1); pending deposits and
     refunds count when they post. New: a transfer can come in as two
     halves on different days, the money leaving and then landing. Between
     the two the money is "in transit", and the check is bank side + in
     transit = app side. A card payment on its way is no longer a mismatch,
     and safe to spend stays on (0.5).

B37. When the totals do not match (0.5), the app holds back the
     safe-to-spend number and shows the difference instead. It still shows
     the days to payday, which does not depend on the bank.

B38. "The split or the mom reserve" (13.1) covers the split and both mom
     reserve numbers: the amount per paycheck and the cap. Other income
     sorted before the next paycheck still uses this pay period's split.
     "This is my paycheck" starts a new pay period, so it uses the new
     split (updated after your A5 answer). Every other setting applies
     right away.

B39. Changed after your review: see 13.6 in the rulebook. A rule made by
     correcting something ("always do this") goes just ahead of the rule
     it corrects, so the fix sticks. Any other new rule still goes to the
     end of your list. A new or changed rule sorts only the waiting items
     it is now the first match for (13.2, found in the review). An older
     rule never sorts them along the way: a purchase waiting because its
     split stopped adding up (A1), or a setup-day difference (A10), stays
     yours to decide unless the new rule itself is the first match.

B40. Changed after your review: see 13.4 in the rulebook. A hand move that
     would leave the bucket it comes out of below zero now asks you to
     confirm first, as moves out of savings and the mom reserve already
     did. The app says why it is asking. Held for others can still be
     moved (for example when a friend says "keep it"), and counts as a
     bucket for this check.

B41. The change log (13.5) records settings changes, rule changes, and
     hand moves, each with its date. How each transaction was sorted is
     kept on the transaction itself.

B42. Setup day also asks for the date of your last paycheck. Section 14
     does not list it, but the pay schedule (section 2, 11.2) and the
     10-day check (3.7) need somewhere to count from until the first
     paycheck arrives.

B43. Setup day takes the bank's posted balances and its list of pending
     charges, and works out the starting money with the pending charges
     included, the same way as the self-check (12.1). The assignment has
     to match it to the cent (14.3). Starting money can be below zero, if
     the everyday card owes more than checking and savings hold.


## Part B, added with the review changes (Oct 6). Tell me if any is wrong.

B44. Money on its way to the old card (12.5): needs pays when it leaves
     checking, since that is when you spent it. The debt goes down when it
     lands, so it matches the old card's balance. It is listed as in
     transit but not counted in the check (12.4).
     Confirmed by you (Oct 6): keep as built.

B45. The two halves of a transfer pair up by the link the bank connection
     gives, when it has one. Otherwise each half pairs with the oldest
     unpaired half between the same two accounts for the same amount. If
     the landing is seen first, it shows in transit as a negative until
     the leaving half shows up.
     Now in the rulebook (12.5).

B46. Money already on its way to savings counts as moved for "still to
     move" (3.8).

B47. For card reminders (9.3, 9.4), a payment is seen from the day it left
     checking or savings. Which statement it counts toward goes by the day
     it reached the card, the way the card applies it (found in the
     review): a payment that left before the statement date and landed
     after it counts toward the new statement. One still on its way counts
     toward the new statement too. A transfer seen in two halves is one
     payment, and the answer is the same whichever half shows up first.
     Now in the rulebook (9.3).

B48. Setup day also takes the transfers with only one half showing that
     day. Money that has left and not landed is added to the starting
     money. A payment that has landed but does not show leaving yet is
     taken off, since it is still counted where it left (found in the
     review). Halves going to the old card do not count either way: the
     old card is outside the starting money, and its balance already
     shows whatever has landed.

B49. "The rule it corrects" (13.6) is the first rule that matches the
     item, as it first showed up or as it posted, even if you had already
     re-sorted the item by hand. Banks often change a purchase's
     description when it posts (found in the review). The new rule's text
     has to match the item one way or the other, otherwise it is refused.
     The app also says whether the fix will catch the next one: text that
     only matches the posted description will not catch the next charge
     while it is still pending. A rule from a correction cannot split
     (rules never split), and fees, early paychecks, store refunds, and mom
     payments cannot get a rule, as before.

B50. "Once per bucket per pay period" (10.2): if a bucket is refilled and
     empties again in the same pay period, there is no second alert. A
     bucket that starts a new pay period still empty alerts again then.
     Now in the rulebook (10.2).

B51. The below-zero check (13.4) looks at the bucket the money comes out
     of. It asks whenever that bucket would end below zero, including when
     it is already below zero and more would come out. Leaving it at
     exactly zero does not ask. Moving money into a bucket that is below
     zero never asks.


## Part B, added with your part A answers (Oct 6). Tell me if any is wrong.

B52. "This is my paycheck" (6.1) works for any deposit in review: a 3.7
     early paycheck, or a deposit the paycheck rule did not recognize
     (a new employer, say). It also works on a deposit you had already
     sorted another way; that earlier choice is undone first. Once it is
     your paycheck it is final, like any paycheck: it cannot be re-sorted,
     because the pay period it started may already have leftover answers
     and spending in it.

B53. The new pay period starts on the day the deposit arrived, not the
     day you answer. So the 14-day schedule (11.2) and the 10-day check
     (3.7) count from that day, and the leftover question covers what was
     in each bucket when you answered.
     Now in the rulebook (6.1).

B54. A deposit older than the last paycheck cannot be "this is my
     paycheck", since pay periods would then run backwards. The app says
     so and the deposit keeps waiting; it can still be other income. A
     deposit on the same day as the last paycheck can be your paycheck.

B55. A deposit rule (6.2) and "always do this" (13.6) can pick other
     income, payback, or not mine, but not "this is my paycheck". Telling
     the app which deposits are paychecks is the job of the paycheck rule
     in settings (section 2), which keeps the 10-day check (3.7). A rule
     that skipped it would split a mistaken second deposit automatically.

B56. "What the bucket started the pay period with" (10.1) is what was in
     it right after the paycheck split, rollover and carried-over
     overspending included. A leftover you then move to savings (3.4)
     comes out of it, since it did not roll over. Paybacks and hand moves
     during the pay period do not change it. Before the first paycheck,
     it is what you gave the bucket on setup day.

B57. "Falls below" is strictly below, to the exact cent: with a start of
     899.99, the level is 179.998, so 180.00 left does not alert and
     179.99 does.
     Now in the rulebook (10.1).

B58. At zero or below only the empty alert comes, never both at once. If
     money then comes back in (a payback, a hand move) and the bucket is
     above zero but still under the level, the low alert comes then, if
     it has not come yet this pay period.
     Now in the rulebook (10.1).


## Part B, added with the A7 answer (Oct 6). Tell me if any is wrong.

B59. The countdown (9.5) counts paydays from the pay schedule, starting at
     the last paycheck. If a payday passes and that paycheck has not come
     yet, the payday is behind today, so it is not one of the paydays left,
     even though the money will still come. Until it does, the countdown
     asks a little more per payday.

## Part B, added with Phase 3, the bank connection (Oct 7). Tell me if any is wrong.

B60. Plaid's "current" balance is the posted one, and the app adds the
     pending charges to it (12.1). Checked against the test bank: there
     "available" is current minus pending money out (plus pending money
     in), so current leaves pending items out. Your real bank gets checked
     the same way in Phase 7.

B61. Only pending purchases count while pending (4.6). Pending money in,
     pending transfers, and pending payments to people (Zelle) wait until
     they post: meanwhile they are in neither the book nor the bank side of
     the self-check (B36). A pending Zelle to mom counts toward the month
     (8.2) once it posts.

B62. A purchase's day (4.1) is the day the bank says it was authorized,
     when it says; otherwise Plaid's date. Everything else is dated the day
     the bank shows it (for money arriving, the day it landed).

B63. A pending charge the bank drops (A2) is dated the day the sync sees
     it dropped, since the bank does not say.

B64. Everything Plaid sends before setup day is history: it is already in
     the starting balances and never reaches the book. Setup day waits
     until Plaid has sent all of the history. Charges pending in it are
     counted on setup day (A10). Halves of transfers with no other half in
     the history are offered as "on their way" for you to confirm (B48).

B65. Bank rules and sorting rules match the bank's own description when
     Plaid has it, otherwise Plaid's tidied-up name. Plaid's name can be
     shorter ("ExxonMobil" for "EXXON VILLAGE SHOP STO").

B66. A card payment's arriving half pairs with money seen leaving for that
     card for the same amount, even when it left savings and the card's
     rule names checking: a card statement often does not say where a
     payment came from (12.5).

B67. Within one sync, items are applied in date order, keeping the bank's
     order within a day (B25); removals come after.

B68. Amounts that are not whole cents, and amounts not in dollars, wait for
     your decision. They are never rounded or converted (0.1). The test
     bank sends some, like 37.804077; real Bank of America amounts should
     never need it.

B69. Accounts in the connection that are not one of your four are left out
     of everything.


## Part B, added with your Phase 3 answers (Oct 7). Tell me if any is wrong.

B70. With B4, the leftover question changes by however much spending made
     before payday takes from that bucket changes between payday and your
     answer: a late purchase, a pending charge posting at a new amount (a
     tip), a re-sort, a refund, or one the bank takes back. Money coming
     back can raise it again, but never above what it asked at payday, and
     it never goes below zero. A purchase still waiting in review counts
     once you sort it into the bucket.

B71. A paycheck the bank takes back (4.10) keeps the pay period it started,
     since its days have passed: only its money comes back out of the
     buckets, the way the paycheck put it in. Leftover answers already
     given stay as they are.

B72. A posted transaction whose amount the bank changes is taken back, and
     the new version counts as new: sorted by your rules, or waiting in
     review. It does not keep the bucket you gave the old version. (A
     pending charge's new amount does keep its bucket, A13.)

B73. A payment marked "for mom" by hand, or by a rule for that person, can
     be sorted again later. It then stops counting toward the month (8.2),
     and the reserve gets back what it gave. One the mom rule matched
     cannot be sorted another way (8.1). A payment partly refunded cannot
     be marked for mom. The difference on a payment for mom (8.3) still
     goes to one bucket, as before (B23).

B74. "Transfer between my accounts" (5.6) works for money out of checking
     or savings (a purchase, a payment to a person, a withdrawal) and for
     money in (a deposit, or a refund on a card, which becomes a card
     payment's arriving half). It works only once a charge has posted, and
     not on one partly refunded or counted on setup day. The app keeps what
     the bank sent: sorting it any other way later makes it that again
     first, and the bank sending it again is still a duplicate. "Always do
     this" cannot make a transfer rule; that is what the bank rules are for
     (section 2).

B75. The take-back alert (10.6) comes once, the next time the alerts are
     taken: one for each transaction taken back, in the order it happened.
     Getting it to your phone at the right time is Phase 5.

B76. A charge pending on setup day, which later posts and is then taken
     back by the bank: its money comes back and waits in review as a
     difference, the same as when such a charge is dropped (A10).

B77. If the bank takes back the half of a transfer that left, and the half
     that arrived names it, the arriving half pairs like one the bank did
     not link: with the oldest unpaired half that left between the same
     accounts for the same amount, or else it shows in transit as arrived
     (12.5).

B78. The bank connection sends money leaving savings that no bank rule
     names as a withdrawal, a kind of its own, never as a purchase. No
     sorting rule sorts it, and "always do this" cannot make one for it
     (4.9). A pending one counts while pending, like a pending purchase
     (4.6, 12.1).

B79. The bank connection now follows the bank when a pending charge's
     amount changes (A13) and when a posted transaction is removed or its
     amount changes (A14), so these no longer wait for your decision or
     show as a self-check difference. A change it still cannot follow (a
     pending charge moved to another account, or a posted one shown as
     pending again) waits for you, as before.
