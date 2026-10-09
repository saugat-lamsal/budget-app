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

## Part A, added with the Home screen (Phase 4, Oct 7). Waiting on your answer.

A17. ANSWERED Oct 7, built. When Home shows a card payment that is due.
     Your answer: option 2. Home shows it every day from the first
     reminder day until it is paid; the phone reminders still come only on
     the reminder days. Rulebook 9.6 and 21a.
     The question was: Home showed exactly what the reminders say. "Everyday card
     due in 7 days" shows on the reminder days only (7 and 2 days before
     the due date), and "Overdue" every day after the due date until the
     minimum is paid. On the days in between, Home says nothing about the
     card.
     Option 1: keep it as built.
     Option 2: from the first reminder day until it is paid, Home shows
     "due in N days" every day. The phone reminders (Phase 5) still come
     only on the reminder days.
     Recommendation: option 2. Home is where you look for what needs you,
     and a bill due in 5 days still does.


## Part A, added with the Buckets and Review screens (Phase 4, Oct 7).

A18. ANSWERED Oct 7, built. A refund in review, and the purchase it
     belongs to. Your answer: option 2. Each likely purchase has "This
     refund is for this one"; the refund is then matched exactly as if the
     bank had matched it. It asks first, since it cannot be undone in
     review. Rulebook 4.5, 6.1 and 22a.
     The question was: Review lists the purchases a refund likely belongs to (20d), but
     rulebook 6.1 gives a refund only two choices: payback into a bucket,
     or not mine. So today, tapping "Into Wants" puts the money in Wants and
     leaves the purchase as it was: the purchase does not count as
     refunded. For a purchase in one bucket the buckets come out the same
     as if the bank had matched them. They differ later: if you re-sort the
     purchase to Needs, the purchase's money moves to Needs but the refund
     stays in Wants. And a split purchase is not sent back to review to be
     split again, as 4.5 does for a matched partial refund.
     Option 1: keep it as built. The list only helps you choose a bucket.
     Option 2: each likely purchase gets a button, "This refund is for this
     one". The refund is then matched exactly as if the bank had said so
     (4.5): back into the bucket the purchase came from, split purchases
     handled as in A1. Needs new wording in 4.5 and 6.1.
     Recommendation: option 2. A refund that follows its purchase cannot end
     up in the wrong bucket later.

A19. ANSWERED Oct 7, built. A new rule that cannot sort everything it
     matches. Your answer: option 2. The rule is made, the waiting items
     that can take it are sorted, and the others stay waiting, exactly as
     they were; the answer names them. Rulebook 13.2 and 22b.
     The question was: Making "always do this" also sorts every waiting item the new rule is
     the first match for (13.2). If one of those cannot take the choice,
     the whole rule is refused, nothing changes, and the screen says so.
     Example: "always for mom" for ZELLE TO A FRIEND, while another waiting
     payment to the same friend was partly refunded: a partly refunded
     payment cannot be for mom (B73), so no rule is made.
     Option 1: keep it. Safe, but confusing: you may not see why.
     Option 2: make the rule, sort the waiting items that can take it, and
     leave the others waiting, saying which.
     Recommendation: option 2. The rule is what you asked for; the one it
     cannot sort is still yours to decide.


## Part A, added with the bucket lists, hand moves, and Payday (Phase 4, Oct 7).

A20. ANSWERED Oct 8, built. Undoing "transfer between my accounts" from a
     list (5.6). Your answer: option 2. On that row, the sheet offers what
     the purchase could be before you marked it (Needs, Wants, a split, a
     transfer with another account); picking one brings it back as the
     purchase the bank sent, and picking Needs is no longer refused.
     Rulebook 5.6 and 23a; the details are B110.
     The question was: a purchase
     you marked as a payment to the old card comes out of Needs (5.2), so
     it shows on Needs' list as "Payment to the old card", and its sheet
     says it always comes out of Needs. Rule 5.6 also says sorting it
     another way later makes it what the bank sent again, and the money
     math can do that, but the list does not offer it. Nowhere else does
     either: it is no longer waiting in review. (A transfer that changes no
     bucket is on no list at all, so this is the only case you can reach.)
     Option 1: leave it as built. If you mark one by mistake, tell me and
     I undo it.
     Option 2: on that row, offer what the purchase could be before you
     marked it (needs, wants, split, and so on), which brings it back as
     the purchase the bank sent. One catch in the money math to fix with
     it: today picking Needs on such a payment is refused, because it is
     read as "keep it a payment to the old card".
     Recommendation: option 2. Marking is easy to get wrong, and this is
     the only way back.


## Part A, added with his answers to A20 and the Payday card (Phase 4, Oct 8). Waiting on your answer.

A21. Undoing a payment you marked as going to the old card FROM SAVINGS
     (5.2, 5.6, A4). A20 is built for checking. From savings the same
     marking waits in review for you to pick Savings or Needs (A4), and
     after that it is on that bucket's list with the same two choices.
     There "Needs" already means something: keep it a payment to the old
     card, taken out of Needs. For the purchase it was (money leaving
     savings, 4.9) "Needs" would mean a different thing, with no change to
     what the old card owes. One tap cannot mean both, so I did not offer
     the purchase's choices there. Today there is no way back from the
     list or from review; you would tell me.
     Option 1: leave as built.
     Option 2: a separate choice on that row and in review, "It was not a
     payment to the old card". It brings the item back as what the bank
     sent, money leaving savings, which waits in review with the usual
     choices (4.9), and the old card owes what it did before.
     Recommendation: option 2. Same reason as A20: marking is easy to get
     wrong. It is its own button, so nothing changes meaning.


## Part A, added with Settings (Phase 4, Oct 9). Waiting on your answer.

A22. The order of the sorting rules (4.2, B9). The first rule that matches
     wins, so the order matters, but nothing lets you change it. Today a new
     rule goes to the end of its list (B39), a changed rule keeps its place,
     and "always do this" puts its rule just ahead of the rule it corrects
     (13.6). Settings numbers each list (purchases, money in, payments to
     people; only rules of the same kind compete) and says "the first rule
     that matches wins".
     Option 1: no reordering. To move a rule to the end, remove it and add it
     again.
     Option 2: "Move up" and "Move down" on each rule's sheet. Each move is in
     the change log (13.5). After a move, what is waiting in Review that the
     rule is now the first match for is sorted, as after a changed rule
     (13.2); what is already sorted stays where it is.
     Option 3: drag the rules into order. Harder to use with a large text
     size, and harder to make work with VoiceOver.
     Option 4: no order at all: the rule with the longest matching text wins
     ("MAIN ST RESTAURANT" beats "RESTAURANT"). Changes 4.2 and B9.
     Recommendation: option 2. Built: option 1, as the rulebook has it, until
     you answer.

A23. Bank rules on Settings (section 2, A12). They tell the bank connection
     which bank items are transfers between your accounts, payments to
     people, and card fees or interest. They live in the server's database,
     not in the book (the money math), and the demo has no database, so
     Settings does not show them yet. Three things to settle:
     a. Where: on Settings now, or with Setup day (the next chunk), where they
        are first set and suggested from the bank's own labels?
     b. Does a change to a bank rule go in the change log (13.5)?
     c. What does a changed bank rule do to items the bank connection has
        already read?
     Option 1: build them with Setup day; Settings then shows the same list
     and can change it. (b) Yes: every change is in the change log, like the
     others. (c) A changed bank rule reads what the bank sends from then on;
     what was already read stays as it is (like 13.2, and 0.3), and one item
     read wrong is fixed in Review with "transfer between my accounts" (5.6).
     Option 2: as option 1, but (c) a changed bank rule also reads again what
     is still waiting in Review.
     Option 3: put them on Settings now, in the demo only, made up and kept
     in memory, before Setup day exists.
     Recommendation: option 1. Reading items again (option 2) means the bank
     connection redoing what it already decided, on items already in the
     book, which risks counting something twice; 5.6 already fixes one item
     at a time. Option 3 is a mock-up that Setup day would replace. Not built.

A24. What is in force this pay period (13.1). The book gave out only the
     settings as they are now, so Settings could not show this pay period's
     split next to the next paycheck's. The book had always kept the split
     and the mom reserve in force for the pay period (other income uses them,
     B38); it now gives them out (Book.splitInForce).
     Option 1: only the split and the two mom reserve numbers (per paycheck,
     and the cap) have a "this pay period" and a "from next paycheck", shown
     side by side; every other setting applies right away (B38) and is shown
     once. The leftover setting says it is used at the next payday.
     Option 2: the book keeps every setting as it was when each pay period
     began, and Settings shows both columns for all of them (Payday could
     then also show the old ones for a past pay period).
     Recommendation: option 1. It is what 13.1 says, and nothing else waits
     for a paycheck. Built: option 1, since this chunk asks Settings to show
     both; option 2 would go on top of it, with nothing built thrown away.


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


## Part B, added with the Home screen (Phase 4, Oct 7). Tell me if any is wrong.

B80. Home shows "Move $X to savings" (3.8) whenever there is money still
     to move, not only on payday. It stays until the money is moved (or
     is on its way, B46). Tapping it shows what should be in the savings
     account and what is there.

B81. When the totals do not match (0.5), Home holds back safe to spend and
     shows the difference instead (B37). The bucket bars and the other
     items on Home still show.

B82. ANSWERED Oct 7, built, changed. When the bank cannot be read, Home
     shows the last safe to spend the bank backed up, greyed, with "As of"
     and the day and time it was checked, in the phone's time zone. It is
     the number from that moment, not one worked out now. If there has
     never been one, Home says "Can't check against the bank" as before.
     Rulebook 0.5 and 21c. Worked example 6. The reading I had to pick
     while building it is B86.

B83. The bucket bars say "Low" or "Empty" whenever the bucket is below
     its level right now (10.1, 10.2). The once-per-pay-period limit is
     for the alerts on your phone (Phase 5); looking at Home never uses
     an alert up.

B84. ANSWERED Oct 7, built, changed. The bank taking something back
     (10.6) shows in Needs attention until you have seen it. Rulebook 10.6
     and 21b. Worked example 5. The reading I had to pick while building
     it is B87.

B86. With B82: "last checked" means the last time the bank was read and
     the totals matched, and the number Home showed then. The server
     remembers it each time that happens (saving it is wired up with the
     rest of the server in a later step; the demo makes one up).

B87. With B84: "seen" means you tapped the take-back and pressed "Got it"
     on the sheet that shows what, how much, and when. Just opening Home
     does not count, and neither does the phone alert (Phase 5). Each
     take-back is its own row, oldest first. Marking one seen changes no
     money. (Since the Review screen, his choices are sent to the server
     too, B91; neither moves money at the bank.)

B85. A late paycheck (B35) shows "Paycheck is 2 days late" with the date
     it was expected.


## Part B, added with the Buckets and Review screens (Phase 4, Oct 7). Tell me if any is wrong.

B88. Which purchases a refund likely belongs to (20d, A15). A purchase is
     listed when it is on the same account as the refund, on or before the
     day of the refund, has at least the refund's amount left to refund
     (4.5), and either shares a name word with the refund or has exactly the
     refund's amount left. A name word is a word of three or more letters
     or digits, ignoring case and punctuation, and not a word that says what
     the bank item is (refund, return, credit, reversal, adjustment,
     purchase, payment). The best come first (same name and amount, then
     same name, then same amount; the newest first among equals), at most
     five. A purchase you already sorted is still listed, with where it
     went. If none qualifies, the screen says "No likely purchase found."
     What tapping does is A18.

B89. Which choices an item gets is decided by the money math for that
     kind of item, from the rulebook, and the screen shows exactly those
     (packages/money/src/review-options.ts). In short: a deposit gets my
     paycheck, other income, payback into any of the four buckets, not
     mine, and a transfer from your other account; an early paycheck the
     same; a store refund payback and not mine; a purchase needs or wants,
     or a split between them; money out of savings the same; a fee or
     interest the same; a payment to a person needs, wants, not mine, or
     for mom, or a split across needs, wants and not mine; the difference
     on a mom payment needs or wants; a payment to the old card from
     savings savings or needs; a payday question roll over or move to
     savings; an old card purchase "Got it". A choice that exists for the
     kind of item but cannot be made right now (my paycheck for a deposit
     older than the last paycheck, B54; a transfer for something pending,
     partly refunded, counted on setup day, or taken back, B74) is not
     offered, and the sheet says why. A split needs at least two cents,
     one for each part, so one cent cannot be split.

B90. "Always do this" (13.6, B49). It is in the "More choices" sheet. Its
     text starts as the whole description the bank gave, which you can
     shorten (a store's name, say), and it must match the description
     (as it first showed or as it posted). With it on, only the choices a
     rule can make are offered: not my paycheck (B55), not a split or a
     transfer. Fees, money out of savings, early paychecks and store
     refunds have no "always do this" (4.9, B17, B49). After it, the
     screen says how many other waiting items the rule sorted too (13.2),
     and whether the next one will go there by itself or may still wait
     while it is pending (B49).

B91. What asks first. "This is my paycheck" (it shows the split it would
     get, from the money math, and the day the pay period starts, B53),
     both answers to a payday question (3.4), and anything with "always do
     this". They are the ones that cannot be taken back here. Everything
     else is one tap, since sorting can be done again (4.7). The server
     refuses them without the "yes" in the request too, so a tap that
     skipped the question would do nothing. The screens send his choices
     to the server, which hands them to the money math; this changes the
     app's own books, never the bank (0.4).

B92. Sending the same choice twice. Each decision gets a number on the
     phone when he makes it, and a retry sends the same number. A repeat of
     a number gets the first answer back and changes nothing, even if the
     answer was lost on the way. A different number for an item that is no
     longer waiting (a double tap that somehow got two numbers, or the
     other window already did it) is told "already dealt with", and
     changes nothing. A choice that was refused is not remembered, so
     fixing it and sending again with the same number is fine. In the demo
     the numbers are kept in memory; the real server must keep them with
     the book's history (hosting, Phase 6), or a restart would forget
     them. The item being no longer in review still protects him then.

B93. The order on Review. Payday questions first, then money in, then
     spending, then old card flags, each oldest first (the book's order for
     the same day). The one main number is how many wait; under it, what
     is held back from safe to spend (4.3), or, when only money back is
     waiting, how much higher safe to spend is until it is sorted (11.1).

B94. What the Buckets screen shows. The one main number is everything in
     the buckets (12.2): savings, needs, wants, mom reserve, held for
     others, and unsorted money in, less unsorted spending. The parts are
     shown, and what waits in review is shown apart, in and out, so they
     add up on the screen. Mom this month is the calendar month of today
     (8.2). Against the target, "Under target" is below the low end, "In
     the target" includes both ends, "Over target" is above the high end.
     The old card debt is shown on its own and is not in the total (12.4);
     a negative one is a credit (B14). Like Home, Buckets says when the
     totals do not match the bank (0.5) and when the bank cannot be read.

B95. Splitting on the screen. You type the amount for the first part (or
     two parts, for a payment to a person); the last bucket gets "the rest",
     worked out by the money math, never by the screen. A rest of nothing,
     or less, is refused and says so, in dollars and cents. The answer says
     what the rest came to.

B96. Money back waiting in review. If a charge counted on setup day posts
     for less, or the bank takes back a purchase after part of it was
     refunded, what is left waiting is money back, shown as a negative
     amount with a minus sign. It can go to needs or wants (it adds to
     that bucket) but cannot be split (4.4).


## Part B, added with the bucket lists, hand moves, and Payday (Phase 4, Oct 7). Tell me if any is wrong.

B97. What "this pay period" covers on a bucket's list. Everything the app
     counted into or out of the bucket since the paycheck that began the
     pay period was counted, up to now. That is the same moment the
     leftover question uses (B53), so the list and the question always
     agree. In practice:
     - A purchase made before payday that first shows up after it (B4) is
       in the new pay period's list, dated the day it was bought.
     - A change after payday to something from the old pay period (a tip, a
       refund, sorting it again, the bank taking it back) puts only that
       change in the new pay period. The old pay period's list stays as it
       was.
     - "Carried in" is what the bucket held when the pay period began,
       before the paycheck. Carried in + came in + went out = what it
       holds now, to the cent; every pay period adds up and joins the next.
     - Before the first paycheck the pay period is the stretch from setup
       day.
     Every bucket has a list: needs, wants, savings, the mom reserve, and
     held for others. Spending and money in that wait in review belong to
     no bucket yet, so they are on no list until they are sorted.

B98. Each item is one row, with everything it did to that bucket this pay
     period added up. Pending and posted versions of a charge are one row.
     A purchase split across buckets has a row in each, with its own part,
     saying "Part of a split". A hand move and a leftover moved to savings
     have a row in both buckets, saying where the other side is. A row
     whose total for the bucket is zero is left out: it was sorted
     somewhere else, marked a transfer, taken back, or dropped while
     pending. The one exception is a purchase refunded in full, which stays
     at $0.00 and says "Refunded $X", so you can see where the refund went.
     A part-refunded purchase shows what is left of it and says how much
     came back. Money that came in has a plus and money that went out has a
     minus.

B99. Newest first, by the day it happened (the day of the purchase, the
     payday for a leftover). On the same day, the one the app counted last
     is first.

B100. Which rows can be sorted again from the list, and with what. Tapping
      a row shows what it is. If the rulebook lets it be sorted again
      (4.7), the sheet gives the same choices review gives that kind of
      item: other bucket, split, "always do this" (13.6), a transfer
      between your accounts (5.6), for mom, not mine, payback, other
      income, "this is my paycheck" (it asks first, B52). The choice it is
      already on is shown as "here now" and cannot be tapped. It cannot be
      sorted again from the list, and the sheet says why:
      - a paycheck (it started a pay period, B52)
      - your answer to a payday question (3.4; move the money by hand to
        change it)
      - a hand move (13.3; move the money back)
      - a refund the bank matched to its purchase (4.5)
      - a payment the mom rule matched (8.1)
      - a payment to the old card from checking, which always comes out of
        needs (5.2), including a purchase you marked as one (A20 asks
        whether to offer undoing that)
      - anything the bank took back or dropped (4.10, 4.6)
      - anything still waiting in review (sort it there)
      Which choices are offered comes from the money math, which also checks
      that the book accepts every one offered and refuses every other.

B101. Sorting something where it already is changes nothing and says "It is
      already in Wants". That also catches a double tap: the second tap has
      its own decision number, and finds it already there. One exception:
      "always do this" on an item that is already where the rule would
      put it is allowed, since the rule is what you asked for. A request
      from a list says it is sorting again; without that, only an item
      waiting in review can be sorted, as before.

B102. "Always do this" from a list works exactly as in review (13.6, B49,
      B90): it asks first, the rule goes just ahead of the rule it
      corrects, anything waiting that it now matches is sorted too, and the
      answer says whether the next one will go there by itself.

B103. Hand moves (13.3, 13.4, 13.5), from Buckets and from the list of each
      bucket. You pick where the money comes from, where it goes, and an
      amount in dollars and cents above zero; any two different buckets of
      the five. It asks first only when 13.4 says: out of savings, out of
      the mom reserve, or if it would leave the bucket below zero. It says
      which, in words, and until you say yes nothing moves. A refused move
      changes nothing and says why. If there is no signal, trying again is
      the same decision, so it moves once. Two separate taps with the same
      amount are two moves, since that can be what you mean. Each move is
      in the change log with the day it was made, and shows on the lists of
      both buckets. Home's safe to spend changes right away. The demo keeps
      the decision numbers in memory, like Review's (B92); the real server
      must keep them with the book's history (Phase 6).

B104. Payday shows what the last paycheck did, step by step, from the
      money math: the mom reserve first (how much came off, how much went
      into the reserve, how much did not fit under the cap and went to
      savings), then the rest split by the percentages (the cents left over
      from rounding go to savings), and what each bucket got, which adds up
      to the paycheck. The percentages and reserve shown are the ones that
      paycheck was worked out with, not the ones in settings now (13.1).
      Before the first paycheck it says there is none and when the next is
      expected. A paycheck the bank took back says so; its pay period
      stays (B71).

B105. "The pay period that just ended" is the one before the current one:
      from its paycheck (setup day for the first) to the day the last
      paycheck was counted. It shows what was spent from needs and wants
      (what purchases, fees and payments took out, after refunds), what was
      sent to mom, and what was left in needs and wants at payday, which is
      what the leftover questions are about.

B106. What became of each leftover is one of four things: nothing to ask
      (the bucket held nothing, or was overspent, so it carries over, 3.5),
      kept (rolled over, by your answer or your setting), moved to savings
      (by your answer or your setting), or still waiting. The setting
      shown is the one in force at that payday. While a question is open
      it asks about what is left after spending from before payday that
      showed up late (B4), which can be less than what the bucket held at
      payday; the amount shown for a leftover that was moved is what
      actually moved.

B107. Payday opens from Home and from Buckets, and Back goes to the one you
      came from. The payday questions you can answer on Payday are the same
      ones as in Review: same desk, same promises, and an answer given in
      one place is answered in the other.

B108. On Buckets, each bucket is a link to its list, there is a "Move money"
      entry, and a Payday row. Home has a Payday row too.

B109. The payday question says why it is smaller. When spending made before
      payday shows up or changes after it (B4), the question asks about
      less than the bucket held at payday. The card says so, in words and
      numbers worked out by the money math: "$657.11 at payday, less
      $34.67 spent before payday and sorted since." It is the same card on
      Payday and in Review, and the line stays on the summary after you
      answer. Nothing is said when nothing was taken off. "Sorted since" is
      your wording; it also covers spending whose amount changed since, such
      as a tip.

B110. Undoing a payment marked as going to the old card (A20), from
      checking. The row is on Needs' list as "Payment to the old card".
      Its sheet says you marked it, and offers what the purchase could be
      before you marked it: Needs, Wants, a split (and, for a payment to a
      person, not mine and for mom), and a transfer with another account,
      but not savings, and not the old card again (marking it with the
      account it already has is refused). Picking a bucket makes it the
      purchase the bank sent, in that bucket. To Needs, nothing changes
      in Needs; to Wants, Wants pays it and Needs has it back. "Always do this"
      makes the rule for the purchase it was. A refused choice changes
      nothing. One the bank sent as a payment to the old card, rather than
      one you marked, still cannot be sorted again.

B111. A kept leftover is what the question asked. If late spending (B4)
      lowered the question and you rolled it over, the report used to say
      you kept what the bucket held at payday; it now says what the
      question asked when you answered, the same as for a leftover you
      moved to savings, with what was taken off shown beside it (B109).
      Nothing moves when you roll over, so no bucket changed; only what
      the Payday screen said.


## Part B, added with Settings (Phase 4, Oct 9). Tell me if any is wrong.

B112. What asks first on Settings. Setting, changing, or clearing the
      paycheck rule or the mom rule always asks first, and shows what it would
      do to what is waiting in Review, from the money math (A9): each item it
      would handle, and every bucket and the number waiting, now and after.
      Removing a sorting rule asks first. Nothing else asks: a new split or
      reserve waits for the next paycheck and can be changed back before
      then, and the other settings can be changed back at any time. Adding or
      changing a sorting rule does not ask (in Review, "always do this" does,
      B91): on Settings the rule is what he set out to make, it can be changed
      or removed right there, and whatever it sorted can be sorted again
      (4.7). The answer says what it sorted, and names what it could not
      (A19).

B113. His yes to the paycheck rule or the mom rule names the preview he saw.
      If what the change would do is no longer that (something arrived in the
      meantime, so an item or a bucket after it would differ), nothing
      happens and it asks again, with what it would do now. The yes uses the
      same decision number as the question, so a retry is still one change
      (B92).

B114. Only what changes is changed. A sheet sends all of its fields (the
      reserve with its cap, say); a setting sent as it already is, is left out,
      so the change log names only what changed. If nothing changes, it says
      "That is already the setting" and nothing is logged (like B101). A rule
      changed to what it already says is the same.

B115. The sorting rules on Settings. A new rule goes to the end of its list
      (B39); a changed rule keeps its place, and can even change kind
      (purchases, money in, payments to people). Each kind is numbered on its
      own, since only rules of the same kind compete (B9). Each kind offers
      only what the money math lets that kind of rule pick (RULE_CHOICES): a
      purchase rule needs or wants (4.2), a money-in rule other income, a
      bucket, or not mine, never "this is my paycheck" (B55), a rule for a
      person needs, wants, not mine, or for mom (7.6). Fees, money out of
      savings, and paychecks have no rules (4.8, 4.9, B55); Settings says so.

B116. The change log on Settings shows every line the book keeps: settings,
      rules (with a rule made from a correction, and the rule it went ahead
      of, as that rule was then, 13.6), hand moves, and the bank taking
      something back (4.10). A settings change that changed several settings
      is one line for each. Newest first; on the same day, the one made last
      first. Each line has its day (13.5 says "with the date"; no time of
      day). A split or reserve change says "from the next paycheck".

B117. "This pay period" on Settings is what the paycheck that began it was
      worked out with (setup day's settings before the first paycheck); "From
      next paycheck" is the setting now, with the day of the next payday from
      the pay schedule. A row that differs says "Changes", in words. A
      paycheck the bank takes back keeps what it put in force, like its pay
      period (B71). See A24.

B118. Changes that apply right away, as B38 says: a new pay schedule moves
      the next payday at once, on Home too (11.2 counts from the last
      paycheck); a new low-bucket percent changes the level of this pay
      period's buckets at once; a new 10-day number applies to the next
      paycheck-looking deposit; a new leftover setting is used at the next
      payday (this payday's questions stay as they are).

B119. Card reminder days can be any whole days, in any order, or none (then
      no reminder comes, and Home shows a card only once it is overdue,
      9.4). A day listed twice reminds once. The promo end date can be any
      real date, even one already past (then all of the old card debt is due
      now, 9.5); "Clear the date" turns the countdown off.

B120. Amounts on Settings are typed in dollars and cents ("1,500.00",
      "1500", "$1,500.00"), read as whole cents, never through a
      floating-point number (0.1); percentages and days are whole numbers.
      What cannot be read is said on the sheet and Save waits. Whether a value
      makes sense (a split adding up to 100, a target's low end not above its
      high end, a real date) is the money math's to say; a refusal says why,
      in words, with what the split adds up to, and changes nothing.

B121. Before setup day there are no settings to change: Settings says so.
