import type { CardRemindersOff } from '@budget-app/server/views';

// Words on Home.

// 11.2: the days to payday. A late paycheck says late (B35).
export function paydayText(days: number): string {
  if (days === 0) return 'Payday is today';
  if (days < 0) return `Paycheck is ${-days} ${-days === 1 ? 'day' : 'days'} late`;
  return `${days} ${days === 1 ? 'day' : 'days'} to payday`;
}

// 10.3
export function waitingText(waiting: number): string {
  return `${waiting} waiting in review`;
}

// 9.1, 9.2: when a card payment is due, on a reminder day.
export function dueText(daysLeft: number): string {
  if (daysLeft === 0) return 'due today';
  return `due in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`;
}

// 9.8 (A52): a card whose reminders are off, on Home and on Settings, in the
// rulebook's words.
export function cardsOffText(off: CardRemindersOff): { readonly title: string; readonly detail: string } {
  const title = `Card reminders are off for the ${off.card === 'everyday-card' ? 'everyday card' : 'old card'}`;
  return off.why === 'no-statement-date'
    ? { title, detail: 'The bank did not send its statement date. Enter the day its statement closes in Settings.' }
    : { title, detail: 'The bank sent a statement for it that cannot be read.' };
}

// After setup day: the rules not set yet (section 2), and what waits for them.
export function stillToSetText(settings: readonly ('paycheckRule' | 'momRule')[]): { readonly title: string; readonly detail: string } {
  const paycheck = settings.includes('paycheckRule');
  const mom = settings.includes('momRule');
  if (paycheck && mom) return { title: 'Still to set: the paycheck rule and the mom rule', detail: 'Until then your paycheck and payments to mom wait in Review. Set them in Settings.' };
  if (paycheck) return { title: 'Still to set: the paycheck rule', detail: 'Until then your paycheck waits in Review. Set it in Settings.' };
  return { title: 'Still to set: the mom rule', detail: 'Until then payments to mom wait in Review. Set it in Settings.' };
}
