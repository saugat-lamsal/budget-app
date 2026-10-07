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
