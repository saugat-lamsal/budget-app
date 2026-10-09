import type { IsoDate } from '@budget-app/money';
import { bankLinesOf, changeBankRules, type BankLine, type BankRuleChange, type BankRuleChanged } from './bank-rules.js';
import type { BankRule } from './bank/reading.js';
import type { Db } from './db/database.js';
import { loadBook, logChange, readAccounts, readBankRules, readItems, saveBankRules } from './db/store.js';
import type { BankRuleLogLine } from './views/bank-rules.js';

// The bank rules kept in the database (section 2, 24c, 13.5). A thin
// wrapper: it reads the rules and the bank items, hands them to the logic
// (bank-rules.ts), and saves what a change did, with its change log line, in
// one transaction. The sync reads the rules each time it runs, so a change
// reads what the bank sends from then on; nothing already read is touched.

const WHAT: Readonly<Record<BankRuleLogLine['action'], string>> = { added: 'bank rule added', changed: 'bank rule changed', removed: 'bank rule removed' };

export function bankLinesIn(db: Db): BankLine[] {
  return bankLinesOf({ accounts: readAccounts(db), items: readItems(db) });
}

// Every change to the bank rules, in the order made.
export function bankRuleLogIn(db: Db): BankRuleLogLine[] {
  const rows = db.prepare("SELECT date, what, detail FROM change_log WHERE what IN ('bank rule added', 'bank rule changed', 'bank rule removed') ORDER BY id").all() as { date: string; what: string; detail: string }[];
  return rows.map((row) => {
    const detail = JSON.parse(row.detail) as { rule: BankRule; before: BankRule | null; afterBookLines: number };
    const action = (Object.keys(WHAT) as BankRuleLogLine['action'][]).find((a) => WHAT[a] === row.what) ?? 'added';
    return { date: row.date, action, rule: detail.rule, before: detail.before, afterBookLines: detail.afterBookLines };
  });
}

export function changeBankRuleIn(db: Db, change: BankRuleChange, date: IsoDate): BankRuleChanged {
  return db.transaction((): BankRuleChanged => {
    const rules = readBankRules(db);
    // An id is never handed out twice: not one in the list, nor one ever logged.
    const ever = [...rules, ...bankRuleLogIn(db).map((l) => l.rule)];
    const issued = Math.max(0, ...ever.map((r) => Number(/^bank-rule-(\d+)$/.exec(r.id)?.[1] ?? 0)));
    const done = changeBankRules(rules, change, `bank-rule-${issued + 1}`);
    if (!done.ok) return done;
    saveBankRules(db, done.rules);
    logChange(db, date, WHAT[done.action], { rule: done.rule, before: done.before, afterBookLines: loadBook(db)?.changeLog().length ?? 0 });
    return done;
  })();
}
