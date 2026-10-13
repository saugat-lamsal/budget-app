# Budget App Rulebook (draft 21)

This is how the app treats every kind of money movement. Each rule has a
number so a test can point at it. Nothing gets coded until you approve this.


## 0. Ground rules

0.1  All amounts are stored in whole cents.
0.2  Every number and rule in this document is a setting you can change in
     the app. Nothing is hard-coded.
0.3  Changing a setting never rewrites a past pay period.
0.4  The app is read-only. It never moves money.
0.5  If the app's totals do not match the bank, it says so instead of showing
     a number it cannot back up. If the bank cannot be read, Home shows the
     last safe to spend that the bank backed up, greyed, with the day and
     time it was checked.
0.6  What the bank sent and every answer you give are kept in order, each
     with the totals after it. If they no longer replay to those totals (a
     fix to the money math that changes what an old event does), the app
     does not start. A separate command shows each event whose totals would
     change, before and after, and with your yes takes the new totals from
     that event on. It goes in the change log (13.5), dated, with what
     changed. If an event cannot be replayed at all (a fix makes the money
     math refuse an old answer), the app does not start either: the command
     says which event and why, and nothing is dropped or replaced.


## 1. Accounts (all Bank of America, one connection)

- Checking (debit card)
- Savings
- Everyday card (the credit card you use normally)
- Old card (the house card, about $3,000, no longer used)

1.1  Connecting the bank. "Connect the bank" is offered only while there
     is no connection. It asks first: it uses 1 of the 10 connections Plaid
     allows, and one that is removed never comes back. The bank's own login
     opens (through Plaid). The app keeps the connection the moment it gets
     it, sealed, on the server only. There is only ever one connection: the
     app never makes a second, and never removes one.
1.2  Which account is which. After connecting, before setup day, you say
     which of the bank's accounts is checking, savings, the everyday card,
     and the old card, each once. Nothing is read from the bank until all
     four are picked. If one is missing, log in to the bank again to add it
     (1.3). Once tracking starts they cannot change. An account that is none
     of the four is never read.
1.3  Logging in to the bank again. When the bank needs it (10.5), when its
     permission is running out (10.13), or to add an account that is
     missing, Settings offers "Log in to the bank again". It keeps the same
     connection: it never uses another of the 10, and nothing already read
     changes.


## 2. Settings and starting values

- Split: savings 50%, needs 30%, wants 20% (must add up to 100)
- Mom reserve: $1,500 per paycheck, capped at $3,000
- Mom monthly target: $2,000 to $3,000
- Low-bucket alert: 20% of what the bucket started the pay period with
- Card reminders: 7 days and 2 days before the due date
- Daily review time: 8:00 PM
- Quiet hours: 10:00 PM to 7:00 AM. No alert is sent then (10.8).
- Bank not read: an alert after 24 hours without a good read of the bank
  (10.7).
- Amounts on the lock screen: off (10.10).
- Stay logged in: 30 days on a device, counted from the login. Logins, new
  passkeys and log outs are logged (13.5).
- Sync with the bank: every 60 minutes, of real time, counted from when the
  last sync started (a clock change does not move it). When the app starts,
  it syncs at once if one is due. A sync that fails changes nothing and is
  tried again at the next time. A change to this is logged (13.5).
- Bank permission ending: told 7 days before the bank's permission to read
  your accounts runs out (10.13).
- History at connection: when the bank is connected, the app asks it for
  the last 90 days. This cannot change once the bank is connected.
- Home time zone: America/New_York. The app's today is the date there,
  whatever time zone the server's own clock is set to. Dates the bank sends
  stay exactly as sent.
- Leftover at payday: ask each time (other options: always roll over,
  always move to savings)
- Old card promo end date: (you fill in)
- Paycheck rule: how your pay shows up on the statement (set after first sync)
- Pay schedule: every 14 days, counted from the last paycheck
- Setup day looks back 10 days for transfers with only one side showing
  (14.2). You can change it on the Setup day screen.
- Mom rule: her name as it appears on transfers (you enter it in the app)
- Bank rules: which bank items are transfers between your accounts,
  payments to people, and card fees or interest. Each is text the bank's
  description contains, on one account (set after the first sync; the
  setup screen also suggests some from the bank's own labels, for you to
  confirm). They can be changed later in Settings, and each change is
  logged (13.5). A changed bank rule reads what the bank sends from then
  on; what was already read stays as it was, and one item read wrong is
  fixed in review (5.6). If two bank rules fit one item, the first in the
  list wins. A rule can be moved up or down among the rules on its account
  (only those can fit the same item), and each move is logged (13.5).


## 3. Payday

3.1  A deposit that matches the paycheck rule is a paycheck and starts a new
     pay period.
3.2  The mom reserve comes off first. If the reserve is already at its cap,
     the part that does not fit goes to savings instead.
3.3  The rest is split by the percentages. Needs and wants are each rounded
     down to the cent, and savings gets the rest, so the parts always add up
     to the paycheck exactly.
3.4  At each payday, unspent needs and unspent wants either roll over into
     the next pay period or move to savings. You choose for each bucket
     separately. Until you answer, the money stays where it is, and you can
     still move it by hand later (13.3). While the question is open,
     spending made before payday that shows up or changes after it (4.1)
     changes the amount asked about by as much, never below zero and never
     above what was asked at payday.
3.5  An overspent bucket carries over as a negative, so the next period
     starts smaller. At payday nothing is asked about it and nothing moves;
     the new share is added on top.
3.6  A third paycheck in a month is handled exactly like any other.
3.7  A paycheck-looking deposit that arrives less than 10 days after the last
     one goes to review instead of splitting automatically.
3.8  On payday the app tells you how much should be sitting in the savings
     account (savings plus mom reserve) and how much you still need to move.
     If the account already holds more than it should, the amount to move
     is $0 and the extra is shown separately.


## 4. Spending

4.1  A purchase on the debit card or the everyday card comes out of a bucket
     on the day of the purchase.
4.2  The bucket is picked by your rules. No matching rule means "unsorted".
     Spending goes to needs or wants only; to pay for something out of
     savings, move the money by hand (13.3).
4.3  Unsorted spending is held back from safe-to-spend until you sort it.
4.4  A purchase can be split across buckets. The parts must add up to the
     total.
4.5  A refund goes back into the bucket the purchase came from. A full
     refund of a split purchase goes back to each bucket as it was split;
     a partial one sends the purchase back to review to be split again. If
     the app cannot match a refund to a purchase, it goes to review. Review
     lists the purchases it likely belongs to; picking one ("this refund is
     for this one") matches it exactly as if the bank had, and cannot be
     undone in review. A likely purchase is on the same account, made on or
     before the refund, with at least the refund's amount not yet refunded,
     and either has the same name as the refund or exactly the refund's
     amount left. The same name means a word of the name is in both; a word
     on most of your purchases on that account (more than half of those on
     the refund's day and in the 90 days before it), such as a city, is not
     a name. At most five are listed, the best first.
     A store's refund to the debit card shows up as money in to checking,
     so money in to checking also lists its likely purchases on checking,
     and picking one makes it that refund (6.1).
     A purchase or payment still waiting in review that is refunded in full
     has nothing left to sort: it leaves review by itself and is kept as a
     record, sorted nowhere. If the bank later takes the refund back (4.10),
     it comes back to review to be sorted.
4.6  A pending charge counts once. When it posts, the final charge replaces
     the pending one, even if the amount changed (a tip, for example). If
     the bank changes a pending charge's amount before it posts, the new
     amount counts right away, in the same bucket. If the bank drops a
     pending charge without posting it (a hold that falls off), it is
     removed and the money goes back to where it came from.
4.7  Re-sorting a purchase updates the buckets right away.
4.8  Fees and interest on the everyday card go to review. Suggested bucket:
     needs.
4.9  Money leaving savings that is not a transfer to one of your accounts
     (5.3, 5.6) or a payment to a person (7.4), such as a withdrawal or a
     bill paid straight from savings, always waits in review, even when a
     rule matches it. It has the same choices as any spending (4.2 to 4.4).
     To pay for it out of savings, sort it and then move the money by hand
     (13.3).
4.10 If the bank takes back a transaction the app already counted (a charge
     shown twice, a correction), the app takes it back too: whatever it did
     to the buckets, the mom reserve, money in transit, or the old card
     debt is undone, and its money goes back where it came from. The change
     is logged (13.5) and you are told (10.6). If the bank changes the
     amount of a posted transaction, the old one is taken back and the new
     one counts as new. A paycheck taken back keeps the pay period it
     started; only its money comes back out of the buckets. A pending
     charge is dropped, not taken back (4.6).


## 5. Transfers and card payments

5.1  Checking to everyday card: not spending. The purchases were already
     counted under 4.1.
5.2  Checking to old card: spending. It comes out of needs, on a "debt
     payoff" line. From savings, it waits in review and comes out of the
     savings bucket once you confirm it, or out of needs if you pick that
     instead.
5.3  Checking to savings, or savings to checking: no bucket changes. The app
     only updates how much still needs to be moved (3.8).
5.4  A new purchase on the old card is flagged and sent to review. Like
     interest and fees (5.5), it raises the debt shown and touches a bucket
     only when you pay it (5.2).
5.5  Interest or fees on the old card raise the debt shown. They touch a
     bucket only when you pay them.
5.6  Review also offers "transfer between my accounts" for money out of
     checking or savings, and for money in, that the bank did not show as
     a transfer. It then counts as that transfer's half: no bucket changes
     (5.1, 5.3), it is in transit until its other half shows (12.5), and a
     payment to the old card counts as one (5.2). Sorting it another way
     later makes it what the bank sent again. One you marked as a payment
     to the old card from savings takes savings or needs (5.2), or has its
     own choice, "It was not a payment to the old card": it is then what
     the bank sent again (money leaving savings waits in review, 4.9), and
     the old card owes what it did before.


## 6. Deposits that are not a paycheck

6.1  They always go to review, with four choices:
     - This is my paycheck: starts a new pay period like any paycheck
       (3.1 to 3.5): the mom reserve first, then the split. The new pay
       period starts on the day the deposit arrived, not the day you
       answer (B53).
     - Other income: split by the percentages only. No mom reserve is
       taken and no new pay period starts. The reserve comes only from
       paychecks.
     - Payback: goes into the bucket you pick
     - Not mine: goes to "held for others"
     A paycheck-looking deposit held back under 3.7 gets the same
     choices. A store refund waiting in review is not income: it gets
     payback and not mine, and it can be matched to the purchase it belongs
     to (4.5). Money in to checking keeps the four choices and also offers
     "this refund is for this one", with its likely purchases on checking
     (4.5).
6.2  A rule can make the choice automatic for a known source.


## 7. Other people's money

7.1  A deposit marked "not mine" adds to "held for others". It is not income
     and is not split.
7.2  A payment out marked "not mine" lowers "held for others". It is not
     spending.
7.3  "Held for others" is shown as its own number and should return to zero.
     A negative number means someone owes you.
7.4  Payments to people go to the daily review unless there is a rule for
     that person. This is the same whichever of your accounts they leave.
7.5  A friend paying you back is a payback (6.1).
7.6  In review, a payment to a person can go to needs, wants, not mine, or
     "for mom", or be split across needs, wants, and not mine; the parts
     must add up to the payment. "For mom" takes it out of the mom reserve
     and counts it toward the month, like a payment the mom rule matches
     (8.1 to 8.3). A rule for a person can say "for mom" too. One marked
     for mom this way can be sorted again later; one the mom rule matches
     cannot.


## 8. Mom

8.1  Any payment that matches the mom rule comes out of the mom reserve,
     whatever the day or amount, and whichever account it leaves. So does
     a payment to a person you mark "for mom" (7.6).
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
     A payment counts toward the statement it reached the card after; one
     landing on the statement date counts toward the one before (B28). It
     counts from the day it leaves checking or savings, even while still on
     its way (B47).
9.4  If the due date passes and the payments the app sees since the
     statement add up to less than the minimum, you get an overdue alert.
     It stays due every day after the due date until enough is paid (B30).
     This works the same on both cards.
9.5  Old card payoff countdown: what the old card owes (5.4, 5.5), divided
     by the paydays left before the promo ends, from the pay schedule:
     paydays after today and before the end date, not on it. Each share is
     rounded up to the cent. With no paydays left, all of it is due now.
     With nothing owed, $0.
9.6  Home shows a card payment as due every day from the first reminder day
     until the payments the app sees add up to what 9.3 asks for. After the
     due date, it shows overdue as in 9.4. The reminders on your phone still
     come only on the reminder days.
9.7  Card reminders and the overdue alert come at the daily review time
     (section 2), with the daily review (10.3). A reminder that goes out
     later than its day counts the days to the due date from the day it
     is sent ("due in 4 days", not "due in 7 days").


## 10. Alerts

10.1  Low bucket: needs or wants falls below the alert level. Once per bucket
      per pay period. The level is 20% of what the bucket started the pay
      period with, including what rolled over. If a bucket starts the pay
      period at zero or below, there is no low alert; the empty alert
      (10.2) covers it. Below means strictly below, to the cent (B57). At
      zero or below only the empty alert comes; back above zero but under
      the level, the low alert comes then, once per pay period (B58).
10.2  Empty bucket: needs or wants reaches zero or below. Once per bucket
      per pay period: refilled and empty again in the same pay period, no
      second alert. Still empty when a new pay period starts, the alert
      comes again (B50).
10.3  Daily review: sent at the review time, only if something is unsorted.
10.4  Totals do not match the bank (section 12). Told when it starts, then
      once a day at the daily review time while it lasts.
10.5  Bank connection needs you to log in again. Told the same way as 10.4.
10.6  The bank took back a transaction the app had counted (4.10). Once,
      when it happens. On Home it stays in Needs attention until you mark it
      seen.
10.7  The bank has not been read for 24 hours (a setting): the sync keeps
      failing, or the app was not running. Told once, when the last good
      read of the bank is that old, and again only after a good read.
10.8  Quiet hours (section 2): no alert is sent from 10:00 PM to 7:00 AM.
      What comes due then waits until they end, and says when it was due:
      "Was due Sat, Oct 3, 8:00 PM." Every alert that goes out late says
      it that way.
10.9  Alerts that came due while the app was not running (the daily review,
      a reminder day): when it is back, only the newest of each kind, and
      only if it is still true then. One daily review, one reminder per
      card.
      The same when the app was running but the phone could not be given
      its alerts (it could not be reached, or no phone had them on): when
      it can be again, of what waited only the newest of each kind goes,
      and only if it is still true then. Each bucket's low alert and empty
      alert are kinds of their own, and each take-back is its own. The
      rest stay in the list of alerts in the app: "Not sent: a newer one
      went." or "Not sent: no longer true."
10.10 On the phone's lock screen an alert shows amounts only if the setting
      says so (off to start): words only, such as "Needs is low", and the
      amounts are in the app.
10.11 Notifications go to each phone where you turned them on, until you
      turn them off there or log out there. They keep coming after that
      phone's login ends (section 2). Logging in again on that phone moves
      them to the new login by itself, and Settings says they are on.
10.12 A phone shows each alert once. It keeps the ids of the newest 500
      alerts it has shown (ids only, never words or amounts) in its own
      storage, so a repeat is dropped even after the phone has stopped and
      started the app's background part. Nothing else is kept on the phone.
10.13 The bank lets the app read your accounts only until a date it sets
      (Bank of America: a year after you connect, or log in to the bank
      again). When the bank gives that date, Settings shows it, and you are
      told once, 7 days before it (section 2), at the daily review time.
      Logging in to the bank again before then moves the date, and nothing
      is lost. If it runs out anyway, the bank needs you to log in again
      (10.5).


## 11. Safe to spend

11.1  Safe to spend = wants left, minus unsorted spending.
11.2  It is shown with the number of days until the next payday, from the
      pay schedule. If that day passes with no paycheck, the days go
      negative instead of jumping ahead (B35).
11.3  Savings, mom reserve, held for others, and unsorted money in are never
      part of it.


## 12. Daily self-check

12.1  Bank side: checking + savings - everyday card balance, including
      pending charges (they already count in the buckets under 4.6),
      savings ones too (4.9).
12.2  App side: savings + needs + wants + mom reserve + held for others
      + unsorted money in - unsorted spending.
      Unsorted money in: deposits and refunds waiting in review
      (3.7, 4.5, 6.1).
12.3  The two must be equal. If not, the app shows a warning with the
      difference: the bank side plus money in transit (12.5), minus the app
      side.
12.4  The old card balance is tracked separately as debt and is not part of
      this check.
12.5  Money in transit: a transfer that has left one of your accounts but not
      yet arrived in another (a card payment, usually) is shown as "in
      transit". The check is: bank side + in transit = app side. Money on its
      way to the old card is shown but not counted, because the old card is
      not part of this check (12.4). It comes out of needs when it leaves
      checking (5.2), and the debt goes down when it lands. The two halves
      pair by the bank's link, otherwise with the oldest unpaired half
      between the same accounts for the same amount. One seen arriving
      first is a negative in transit until it shows leaving (B45).


## 13. Changing things on the fly

13.1  A change to the split or the mom reserve applies from the next
      paycheck. Settings shows the split and the mom reserve in force this
      pay period next to what the next paycheck will use. Every other
      setting applies right away.
13.2  A new or changed sorting rule applies to new and unsorted transactions.
      Already-sorted ones stay put unless you re-sort them. Setting the
      paycheck rule or the mom rule does the same with what is waiting: a
      deposit that matches the paycheck rule becomes a paycheck, still with
      the 10-day check (3.7), and a payment that matches the mom rule comes
      out of the mom reserve (8.1). A waiting item the rule matches but
      cannot sort (a partly refunded payment cannot be for mom, for
      example) stays waiting exactly as it was, and you are told which.
      You can move a sorting rule up or down in its list (only rules of
      the same kind compete, so the first of them that matches wins). Each
      move is logged (13.5), and what is waiting in review that a moved rule
      is now the first match for is sorted, as after a changed rule.
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
13.7  An answer about an item that changed since the screen showed it (a
      sync came in between) is refused, says how the item is now, and
      changes nothing. Changed means its amount, day, description, pending
      or posted, what a payday question asks, where it is sorted now, or
      what "this is my paycheck" would do. What the item is offered is not
      part of it: a choice no longer offered is refused anyway. A hand move
      and the settings are not about one item: a move still asks first when
      it would leave a bucket below zero (13.4), and the paycheck rule and
      the mom rule ask again when what they would do has changed.
      When a screen reads its numbers again (coming back from the
      background, for example) and an item on it is not what it showed
      before, the item says so where it is ("Changed: now $21.50,
      posted") and takes no tap for about a second, so a tap meant for what
      was there before is not sent. An item you answered yourself is not
      marked.


## 14. Setup day

14.1  The app reads your current balances.
14.2  You assign the starting money (checking + savings - everyday card
      balance) across savings, needs, wants, mom reserve, and held for
      others. Charges still pending that day are part of the starting
      money. If one later posts at a different amount, is refunded, or is
      dropped, only the difference waits in review. Money on its way
      between your accounts that day is part of it too (12.5): setup day
      asks about each transfer with only one side showing from the last 10
      days (section 2), and you say whether it is still on its way. Older
      ones are history.
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
c.  Low bucket alert: 20% of what the bucket started the pay period with,
    including rollover. A bucket that starts at zero or below gets no low
    alert; the empty alert covers it (10.1).
d.  Everyday card: the overdue alert works like the old card's. It stops
    once the payments since the statement total at least the minimum
    (9.4).
e.  Old card payoff countdown: the debt the app tracks, divided by the
    paydays after today and before the promo end date (not on it), each
    share rounded up to the cent. With no paydays left, all of it is due
    now; with nothing owed, $0 (9.5, QUESTIONS.md A7).
f.  A savings account holding more than it should: the amount to move is
    $0, and the extra is shown separately (3.8).
g.  A refund of a split purchase: a full refund goes back to each bucket
    as it was split; a partial one sends the purchase back to review to be
    split again (4.5, QUESTIONS.md A1).
h.  Rounding at payday: needs and wants are each rounded down to the cent,
    and savings gets the rest (3.3).
i.  A bucket at zero or below at payday: nothing is asked and nothing
    moves. It carries over, and the new share is added on top (3.5).
j.  The self-check difference is the bank side (plus money in transit)
    minus the app side (12.3).
k.  A pending charge the bank drops without posting it is removed, and its
    money goes back where it came from (4.6, QUESTIONS.md A2).
l.  Spending goes to needs or wants only (4.2, A3).
m.  A payment to the old card from savings comes out of the savings bucket
    once you confirm it, or out of needs if you pick that (5.2, A4).
n.  Setting the paycheck rule or the mom rule also checks what is waiting
    in review (13.2, A9).
o.  A charge pending on setup day: only a later difference waits in review
    (14.2, A10).


## 19. Readings from QUESTIONS.md part B, now in the rules (Oct 6, 2026)

The second-opinion tests (PR #4) found these places unclear in the
rulebook. QUESTIONS.md part B already had the answers, and the app already
works that way: 6.1 (B53), 9.3 (B28, B47), 9.4 (B30), 10.1 (B57, B58),
10.2 (B50), 11.2 (B35), 12.5 (B45).


## 20. Answers to the Phase 3 questions (Oct 7, 2026)

a.  How the app tells transfers, payments to people, and card fees from
    purchases: bank rules, now a setting (section 2). The setup screen
    will also suggest rules from the bank's own labels, for you to confirm
    (Phase 4). Review also offers "transfer between my accounts" (5.6,
    QUESTIONS.md A12).
b.  A pending charge whose amount changes before it posts: the new amount
    counts right away, in the same bucket (4.6, A13).
c.  A transaction the bank takes back or changes after the app counted it:
    the app follows the bank, logs the change, and tells you (4.10, 10.6,
    A14).
d.  Which purchase a refund belongs to: every refund the bank does not
    match waits in review, as now (4.5). In Phase 4, review lists the
    purchases it likely belongs to (A15).
e.  A payment to a person is handled the same whichever of your accounts
    it leaves; mom's from savings comes out of the mom reserve. Other money
    leaving savings waits in review with the usual choices (4.9, 7.4, 8.1,
    A16).
f.  A purchase from before payday that shows up after it lowers the open
    leftover question, never below zero (3.4, QUESTIONS.md B4).
g.  "For mom" is a review choice for payments to people, and a payment to
    a person can be split across needs, wants, and not mine (7.6,
    QUESTIONS.md B20 and B26).


## 21. Answers to the Phase 4 questions (Oct 7, 2026)

a.  Home shows a card payment as due every day from the first reminder
    day until it is paid, not only on the reminder days (9.6,
    QUESTIONS.md A17).
b.  A transaction the bank took back stays in Needs attention on Home
    until you mark it seen (10.6, QUESTIONS.md B84).
c.  When the bank cannot be read, Home shows the last checked safe to
    spend, greyed, with the day and time it was checked (0.5,
    QUESTIONS.md B82).


## 22. Answers to the Buckets and Review questions (Oct 7, 2026)

a.  A refund waiting in review can be matched to one of the purchases it
    likely belongs to. It then counts exactly as if the bank had matched
    it: back into the bucket the purchase came from, and a split purchase
    as in 4.5. It asks first (4.5, 6.1, QUESTIONS.md A18).
b.  A new rule sorts the waiting items it can and leaves the others
    waiting, saying which, instead of being refused whole (13.2,
    QUESTIONS.md A19).


## 23. Answers after the bucket lists, hand moves, and Payday review (Oct 8, 2026)

a.  A purchase you marked as a payment to the old card (5.6) can be undone
    from its row on Needs' list: sorting it any other way makes it the
    purchase the bank sent, in that bucket. Marking it again with the
    account it already has is not a choice (5.6, QUESTIONS.md A20, B110).
b.  A payday question that spending from before payday made smaller (3.4,
    B4) says why on its card: what the bucket held at payday, less what
    was spent before payday and has shown up since (QUESTIONS.md B109).


## 24. Answers after the Settings screen (Oct 9, 2026)

a.  A payment you marked as going to the old card from savings can be
    unmarked with its own choice, "It was not a payment to the old card",
    in review and from its bucket's list. It becomes what the bank sent
    again, and the old card owes what it did before (5.6, QUESTIONS.md
    A21).
b.  Sorting rules can be moved up or down in their list, and each move is
    logged (13.2, 13.5, A22).
c.  Bank rules come with setup day and can be changed in Settings. Each
    change is logged; a changed bank rule reads what comes from then on,
    and what was already read stays as it was (section 2, A23).
d.  Only the split and the mom reserve wait for the next paycheck.
    Settings shows them for this pay period next to the next paycheck's;
    every other setting applies right away (13.1, A24).


## 25. Answers after Setup day (Oct 9, 2026)

a.  Setup day asks about transfers with only one side showing from the last
    10 days, and 10 is a setting (section 2, 14.2, QUESTIONS.md A25).
b.  A purchase or payment waiting in review that is refunded in full leaves
    review by itself and is kept as a record. If the bank takes the refund
    back, it comes back to review (4.5, QUESTIONS.md A26).


## 26. Answers after bank rules (Oct 9, 2026)

a.  When two bank rules fit one item, the first in the list wins, as with
    sorting rules. A bank rule can be moved up or down among the rules on
    its account, and each move is logged (section 2, 13.5, QUESTIONS.md
    A27).

b.  Today is the date in his home time zone, a setting that starts at
    America/New_York, never the date in the server's own clock zone. Dates
    the bank sends stay exactly as sent (section 2).


## 27. Answers after the real server keeps everything (Oct 10, 2026)

a.  When the history no longer replays to the totals saved with it, the
    server stays stopped. A separate command shows each event whose totals
    would change, before and after, and with your yes takes the new totals
    from that event on, logged in the change log (0.6, 13.5, QUESTIONS.md
    A28).
b.  Money in to checking also offers "this refund is for this one", with
    the likely purchases on checking, the same as a card refund (4.5, 6.1,
    QUESTIONS.md A29).
c.  You stay logged in for 30 days on a device, and that is a setting
    (section 2).
d.  The app syncs with the bank by itself every 60 minutes, and that is a
    setting (section 2).


## 28. Answers after syncing on a timer (Oct 10, 2026)

a.  An old event the money math now refuses: the server stays stopped, and
    npm run replay-check says which event and why. Nothing is dropped or
    replaced (0.6, QUESTIONS.md A30).
b.  An answer about something a sync just changed is refused with how it
    is now, and nothing changes: an item that is not what the screen showed
    (13.7, QUESTIONS.md A31).


## 29. Answers after Phase 4's finish line (Oct 10, 2026)

a.  When a screen reads its numbers again and an item on it has changed,
    the item says so and takes no tap for about a second, so a tap meant
    for what was there before is not sent (13.7, QUESTIONS.md A32).
b.  A refund's likely purchases share a name with it or have exactly its
    amount left, at most five. A word on most of your purchases on that
    account, over the refund's day and the 90 days before it, is not a
    name, so "Same name" is true (4.5, QUESTIONS.md A33).


## 30. Answers after the alerts were worked out and kept (Oct 11, 2026)

a.  Card reminders and the overdue alert come at the daily review time,
    with the daily review (9.7, QUESTIONS.md A34).
b.  Quiet hours, 10:00 PM to 7:00 AM, a setting: what comes due then
    waits until they end, and says when it was due (10.8, A35).
c.  Alerts that came due while the app was not running: when it is back,
    only the newest of each kind, and only if it is still true (10.9,
    A36).
d.  "Totals do not match the bank" and "log in to the bank again" repeat
    once a day at the daily review time while they last (10.4, 10.5,
    A37).
e.  A new alert when the bank has not been read for 24 hours, a setting;
    again only after a good read (10.7, A38).
f.  Amounts on the lock screen are a setting, off to start (10.10, A39).


## 31. Answers on late alerts (Oct 11, 2026)

a.  A card reminder that goes out late counts the days to the due date
    from the day it is sent, and the line saying an alert went out late
    reads "Was due Sat, Oct 3, 8:00 PM.", not "Due" again (9.7, 10.8,
    QUESTIONS.md B185, B186).


## 32. Answers on the phone (Oct 12, 2026)

a.  Alerts the phone could not be given for a while: when it can be again,
    only the newest of each kind goes, if still true; the rest show in the
    list as not sent. This changes "once" for those alerts only (10.9,
    QUESTIONS.md A40).
b.  Notifications keep coming after a phone's login ends. Logging in again
    on that phone moves them to the new login by itself, and its card says
    "On" (10.11, A41).
c.  The phone keeps only the ids of the newest 500 alerts it showed, in the
    service worker's own storage, so a repeat stays dropped after the
    service worker restarts (10.12, A42).


## 33. Answers before Phase 7 (Oct 12, 2026)

a.  When the bank is connected, the app asks it for the last 90 days of
    history (section 2, QUESTIONS.md A44).
b.  When the bank gives the date its permission to read your accounts runs
    out, Settings shows it, and you are told 7 days before (10.13, A45).
c.  Connecting the bank, which account is which, and logging in to the
    bank again (1.1 to 1.3, QUESTIONS.md A46).
