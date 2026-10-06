# Open questions from Phase 1

Two kinds of questions are listed here.

Part A: the rulebook does not say. Either the case is not built yet, or,
where money has to land somewhere to keep the totals right, it goes to
review so you decide each time. Each one has options and a recommendation.

Part B: the plain reading of the rule was built, but a reasonable person
could have meant something else. Each one says what the app does now.
Nothing to do unless one of them is wrong.


## Part A. Waiting on your answer

A1. A refund on a split purchase, or a split purchase that posts at a
    different amount (4.4 with 4.5 and 4.6).
    Example: 120.00 split 100.00 needs / 20.00 wants, then 20.00 comes back.
    Which bucket gets it?
    Now: the purchase goes back to review with its new total, and you
    split it again.
    Option 1 (now): back to review to split again.
    Option 2: share it out in the same proportions as the split.
    Option 3: it all goes to the bigger part.
    Recommendation: option 1. It is rare, and you know which part the
    refund was for.

A2. A pending charge that disappears without posting (4.6).
    Gas stations and hotels often put a hold that drops off later. The
    rulebook covers a pending charge posting, not one vanishing.
    Now: not built. There is no way yet to tell the app a pending charge
    was cancelled, so the bucket would stay lower than the bank.
    Option 1: the charge is removed and the money goes back to the bucket
    it came from.
    Option 2: the money goes to review.
    Recommendation: option 1. It is what actually happened.

A3. Can spending be sorted straight to savings or the mom reserve?
    (4.2, 4.4)
    Now: spending goes to needs or wants only. To pay for something out of
    savings, sort it to needs, then move money from savings to needs by
    hand (13.3), which asks you to confirm (13.4).
    Option 1 (now): needs or wants only.
    Option 2: allow savings and the mom reserve too, with the same confirm
    as 13.4.
    Recommendation: option 1. It keeps the confirm step for savings.

A4. A payment to the old card from savings instead of checking (5.2).
    5.2 covers checking to the old card. From savings, which bucket pays?
    Now: the debt goes down right away, and the payment waits in review
    as unsorted spending until you pick needs or wants.
    Option 1: needs, same as from checking. "Still to move" (3.8) would
    then go up, because the money left the savings account but not the
    savings bucket.
    Option 2: the savings bucket, since that is where the money came from.
    Asks you to confirm, like 13.4.
    Option 3 (now): review each time.
    Recommendation: option 2.

A5. Does "income" from review start a new pay period? (6.1 with 3.1, 3.7)
    6.1 says income is "treated like a paycheck (reserve, then split)".
    It does not say whether it also starts a new pay period, which would
    ask the leftover question (3.4), restart the 14-day schedule (11.2),
    and restart the 10-day count (3.7).
    Now: reserve, then split, and nothing else. No new pay period.
    This matters most for a real paycheck that arrives early (3.7), for
    example before a holiday. Today it goes to review, and "income" splits
    it but does not restart the schedule, so the next payday shown would be
    off.
    Option 1 (now): income never starts a new pay period.
    Option 2: income always starts one.
    Option 3: add a fourth choice for 3.7 items only, "this is my
    paycheck", which splits it and starts a new pay period. A bonus or tax
    refund stays plain income.
    Recommendation: option 3.

A6. Paying a card in more than one payment (9.3, 9.4).
    9.3 says reminders stop at "a payment that covers at least the
    minimum". 9.4 says the overdue alert comes when the due date passes
    with "no payment seen". Neither says what happens with two smaller
    payments, or one payment below the minimum.
    Now (the literal reading): reminders stop only when one single payment
    is at least the minimum. Any payment at all, even below the minimum,
    stops the overdue alert.
    Option 1 (now): as above.
    Option 2: add up every payment since the statement. Reminders stop once
    the total reaches the minimum. If the total is still short on the due
    date, you get the overdue alert.
    Recommendation: option 2. It matches what the bank checks before
    charging a late fee.

A7. Old card payoff countdown (9.5). Not built yet; it shows "off".
    The promo end date is still missing (rulebook section 16), and these
    details are not in the rule:
    a. Which paychecks count as "left": paydays after today and before the
       promo end date? What if a payday falls on the end date itself?
    b. Rounding: the balance rarely divides evenly. Round each share up to
       the cent (the last payment comes out slightly smaller), or show the
       exact share and let the extra cents fall on the last payment?
    c. If no paychecks are left before the promo ends, show the whole
       balance as due now?
    d. Which balance: the old card debt the app tracks (5.4, 5.5), or the
       last statement balance?
    Recommendation: a. paydays after today and before the end date, not on
    it; b. round up to the cent; c. yes, the whole balance; d. the debt the
    app tracks.

A8. Low bucket alert (10.1). Skipped.
    "20% left" does not say 20% of what. Buckets carry money over (3.4),
    carry overspending over (3.5), and get paybacks and hand moves during
    the period, so "what the bucket had" is not one obvious number.
    Option 1: 20% of what the bucket held right after the last payday
    (the new share plus anything carried over).
    Option 2: 20% of the new share from the last paycheck only.
    Option 3: option 1, plus anything added during the period (paybacks,
    hand moves in).
    Also: if a bucket started the period at zero or below, should the low
    alert be skipped and the empty alert (10.2) cover it?
    And: "falls below" means strictly below, so exactly 20% left does not
    alert. Right?
    Recommendation: option 1; yes, skip it when the bucket started at zero
    or below; yes, strictly below.

A9. Setting the paycheck rule or the mom rule after the first sync.
    Section 2 says the paycheck rule is "set after first sync", so the
    first paychecks will be waiting in review when you set it. 13.2 says a
    new sorting rule also sorts what is waiting, but these two are
    settings, not sorting rules.
    Now: they apply to new transactions only. Deposits and payments
    already waiting in review are not re-checked.
    Option 1 (now): new transactions only.
    Option 2: re-check what is waiting, like 13.2. A waiting deposit that
    matches the new paycheck rule is then treated as a paycheck (with the
    3.7 ten-day check), and a waiting payment that matches the mom rule
    comes out of the mom reserve.
    Recommendation: option 2.

A10. Charges still pending on setup day (14.2 with 4.6).
     The starting money includes them (12.1), so they come out of no
     bucket. The rulebook does not say what happens when one later posts
     at a different amount, or is refunded.
     Now: only the difference waits in review, and you pick the bucket.
     Posting at the same amount changes nothing. Worked example 13.
     Option 1 (now): as above.
     Option 2: on setup day, you also pick a bucket for each pending
     charge, so it behaves like any other purchase from then on.
     Recommendation: option 1. Setup day usually has only a few pending
     charges, and most post at the same amount.


## Part B. Built on the plain reading. Tell me if any is wrong.

B1. Paycheck smaller than the mom reserve (3.2).
    A $1,200 paycheck can only give the reserve $1,200, not $1,500. The
    whole paycheck goes to the reserve (up to the cap; any part that does
    not fit goes to savings), and nothing is left to split, so needs and
    wants get $0 that payday. Worked example 3.

B2. Leftover amount is fixed at payday (3.4).
    The question "roll over or move?" is about what was left in the bucket
    when the paycheck arrived. If you answer a few days later, that same
    amount moves, even if you have spent from the bucket since.

B3. A second payday before you answer the first leftover question (3.4).
    The old question is replaced by a new one covering everything now in
    the bucket (the old leftover plus anything unspent since). Answering
    both would otherwise move the same money twice.

B4. A purchase that shows up after payday but was made before it (3.4
    with 4.1).
    Rule 4.1 says a purchase comes out of a bucket on the day you made it.
    If Friday's dinner only appears on Saturday, after Friday's paycheck,
    it still comes out of the same bucket, but the leftover question was
    already worked out without it. Right now the question keeps the amount
    from payday (B2).
    Option 1 (now): leave the question as it is.
    Option 2: if the question is still open, lower its amount by the late
    purchase (not below zero).
    Recommendation: option 2, since it follows 4.1 more closely. Small
    change; say the word.

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

B16. A store refund the app cannot match (4.5) can be payback or not mine,
     but not income.

B17. Deposit rules (6.2) never apply to a paycheck. The paycheck rule is
     checked first, and an early paycheck (3.7) always goes to review.

B18. Income uses the mom reserve and its cap exactly like a paycheck
     (3.2), including when the income is smaller than the reserve
     (worked example 7).

B19. A 3.7 early paycheck in review gets the same three choices as any
     other deposit (6.1). 3.7 itself does not list choices. See A5.

B20. A payment to a person can be sorted to needs, wants, or not mine. It
     cannot be split: 4.4 talks about purchases only (7.4).

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
     mom rule (8.1).

B27. If you re-sort income after mom was already paid from the reserve it
     filled, the reserve can drop below zero. A mom payment then takes
     nothing from the reserve and all of it waits in review (8.3).

B28. Card reminders go out exactly 7 and 2 days before the due date
     (calendar days; both are settings). A payment counts toward a
     statement when it is dated after the statement date and on or before
     today (9.1 to 9.3).

B29. A statement with a $0 minimum gets no reminder and no overdue alert.

B30. The overdue alert (9.4) is due on every day after the due date until
     a payment is seen. Making sure it reaches the phone once is Phase 5.

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
     reserve numbers: the amount per paycheck and the cap. Income sorted
     before the next paycheck still uses this pay period's split. Every
     other setting applies right away.

B39. Changed after your review: see 13.6 in the rulebook. A rule made by
     correcting something ("always do this") goes just ahead of the rule
     it corrects, so the fix sticks. Any other new rule still goes to the
     end of your list. A purchase waiting because its split stopped adding
     up (A1) counts as unsorted, so a new rule can sort it.

B40. Hand moves (13.3) can take a bucket below zero, and held for others
     can be moved too (for example when a friend says "keep it"). Only
     moves out of savings or the mom reserve ask first (13.4).

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

B45. The two halves of a transfer pair up by the link the bank connection
     gives, when it has one. Otherwise each half pairs with the oldest
     unpaired half between the same two accounts for the same amount. If
     the landing is seen first, it shows in transit as a negative until
     the leaving half shows up.

B46. Money already on its way to savings counts as moved for "still to
     move" (3.8).

B47. For card reminders (9.3, 9.4), a payment counts on the day it left
     checking or savings, not the day it reached the card.

B48. Setup day also takes the transfers in transit that day. They are part
     of the starting money, except ones going to the old card, which have
     already left the accounts the starting money counts.

B49. "The rule it corrects" (13.6) is whichever rule matches the item
     right now, even if you had already re-sorted the item by hand. The new
     rule's text has to match the item it corrects, otherwise it is
     refused. A rule from a correction cannot split (rules never split),
     and fees, early paychecks, store refunds, and mom payments cannot get
     a rule, as before.

B50. "Once per bucket per pay period" (10.2): if a bucket is refilled and
     empties again in the same pay period, there is no second alert. A
     bucket that starts a new pay period still empty alerts again then.
