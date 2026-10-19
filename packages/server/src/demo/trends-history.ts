import { addDays, type Cents, type IsoDate } from '@budget-app/money';
import { checkBankRules } from '../bank/reading.js';
import type { BeforeSetup, HistoryLine } from '../trends.js';
import { DEMO_BANK_RULES } from './scenarios.js';

// A made-up bank history from before the demo's setup day (Sep 19, 2026;
// the last paycheck Sep 18), for the Trends tab (40.1, 40.3): the 90 days
// asked for at connection, from Jun 21. Every name, amount and date is
// invented. Pay periods go back from Sep 18 every 14 days.

const LAST_PAYCHECK: IsoDate = '2026-09-18';

export function madeUpTrendsHistory(): BeforeSetup {
  const lines: HistoryLine[] = [];
  let n = 0;
  // Plaid's sign: positive is money out.
  const add = (date: IsoDate, account: HistoryLine['account'], amount: Cents, description: string): void => {
    lines.push({ id: `trend-${(n += 1)}`, account, date, amount, description });
  };
  // Six pay periods back, each a little different, and the four days before setup day.
  const starts = ['2026-06-26', '2026-07-10', '2026-07-24', '2026-08-07', '2026-08-21', '2026-09-04'];
  starts.forEach((start, i) => {
    const day = (k: number): IsoDate => addDays(start, k);
    add(day(0), 'checking', -412_000, 'MADE UP EMPLOYER PAYROLL');
    add(day(1), 'checking', 9_412 + i * 611, 'GROCERY OUTLET #12');
    add(day(8), 'checking', 7_205 - i * 233, 'GROCERY OUTLET #12');
    add(day(2), 'everyday-card', 575, 'BLUE DOOR COFFEE');
    add(day(6), 'everyday-card', 625, 'BLUE DOOR COFFEE');
    add(day(11), 'everyday-card', 575, 'BLUE DOOR COFFEE');
    add(day(4), 'everyday-card', 4_380 + i * 950, 'HARBOR RESTAURANT');
    add(day(5), 'everyday-card', 3_950 + (i % 3) * 400, 'CORNER GAS STATION');
    add(day(9), 'everyday-card', 1_599, 'RIVER STREAMING');
    if (i % 2 === 0) add(day(7), 'everyday-card', 2_899, 'CITY BOOKSHOP');
    add(day(3), 'checking', 20_000, 'PAYMENT TO OLD CARD');
    add(day(10), 'checking', 45_000, 'PAYMENT TO EVERYDAY CARD');
    add(day(12), 'checking', 60_000, 'ZELLE TO MADE UP MOM');
  });
  add(LAST_PAYCHECK, 'checking', -412_000, 'MADE UP EMPLOYER PAYROLL');
  add('2026-09-18', 'everyday-card', 575, 'BLUE DOOR COFFEE');
  // One more made-up bank rule for this history: paying the old card from
  // checking (5.2). Made here, not when the file loads: scenarios.ts loads this file.
  const bankRules = checkBankRules([...DEMO_BANK_RULES, { id: 'bank-rule-6', account: 'checking', contains: 'PAYMENT TO OLD CARD', means: 'transfer', other: 'old-card' }]);
  return { setupDay: '2026-09-19', lastPaycheckDate: LAST_PAYCHECK, historyFrom: '2026-06-21', lines, bankRules };
}
