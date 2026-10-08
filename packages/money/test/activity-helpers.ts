import { ACTIVITY_KINDS, MOVABLE_POTS, type Book, type Cents, type StartingPots } from '../src/index.js';

// What a bucket's activity must always satisfy, checked on a book after
// anything has happened to it. Worked out here on its own, from the numbers
// the book gives, so the checks do not lean on the code they check.
//
// For every bucket and every pay period: what it held at the start, plus what
// came in, plus what went out, is what it held at the end (QUESTIONS.md B97);
// the rows add up to what came in and went out; one pay period ends with
// exactly what the next one starts with; the last one ends with what the
// bucket holds now; and the first one starts with what setup day gave it.
export function activityProblems(book: Book, start?: StartingPots, from = 0): string[] {
  const problems: string[] = [];
  const pots = book.pots();
  const current = book.period().number;
  for (const pot of MOVABLE_POTS) {
    let carried: Cents | undefined = from === 0 ? start?.[pot] : undefined;
    for (let k = from; k <= current; k += 1) {
      const a = book.activity(pot, k);
      const where = `${pot}, pay period ${k}`;
      if (a.pot !== pot || a.period.number !== k) problems.push(`${where}: asked for it, got ${a.pot} period ${a.period.number}`);
      if (a.opening + a.in + a.out !== a.closing) problems.push(`${where}: opening ${a.opening} + in ${a.in} + out ${a.out} is not closing ${a.closing}`);
      const rows = a.rows.reduce((sum, row) => sum + row.amount, 0);
      if (rows !== a.in + a.out) problems.push(`${where}: the rows add up to ${rows}, in and out to ${a.in + a.out}`);
      const wantIn = a.rows.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
      const wantOut = a.rows.filter((row) => row.amount < 0).reduce((sum, row) => sum + row.amount, 0);
      if (a.in !== wantIn || a.out !== wantOut) problems.push(`${where}: in ${a.in} and out ${a.out}, but the rows give ${wantIn} and ${wantOut}`);
      if (carried !== undefined && a.opening !== carried) problems.push(`${where}: starts with ${a.opening}, but the one before ended with ${carried}`);
      if ((a.period.endDate === null) !== (k === current)) problems.push(`${where}: only the current pay period has no end day`);
      carried = a.closing;
      const ids = a.rows.map((row) => row.id);
      if (new Set(ids).size !== ids.length) problems.push(`${where}: an item is listed twice`);
    }
    if (carried !== pots[pot]) problems.push(`${pot}: the last pay period ends with ${String(carried)}, the bucket holds ${pots[pot]}`);
  }
  return problems;
}

// The same for a pay period added up by kind of entry (QUESTIONS.md B105):
// opening plus everything it did, kind by kind, is closing, and it agrees with
// the lists of the same bucket and pay period.
export function summaryProblems(book: Book, from = 0): string[] {
  const problems: string[] = [];
  const current = book.period().number;
  for (let k = from; k <= current; k += 1) {
    const s = book.periodSummary(k);
    if (s.number !== k) problems.push(`asked for pay period ${k}, got ${s.number}`);
    if ((s.endDate === null) !== (k === current)) problems.push(`pay period ${k}: only the current pay period has no end day`);
    const next = k < current ? book.periodSummary(k + 1) : undefined;
    for (const pot of MOVABLE_POTS) {
      const where = `${pot}, pay period ${k}`;
      const kinds: Cents = ACTIVITY_KINDS.map((kind) => s.byKind[pot][kind]).reduce((sum, c) => sum + c, 0);
      if (s.opening[pot] + kinds !== s.closing[pot]) problems.push(`${where}: opening ${s.opening[pot]} plus ${JSON.stringify(s.byKind[pot])} is not closing ${s.closing[pot]}`);
      const a = book.activity(pot, k);
      if (a.opening !== s.opening[pot] || a.closing !== s.closing[pot]) problems.push(`${where}: the list and the summary disagree about where it started or ended`);
      if (a.in + a.out !== kinds) problems.push(`${where}: the list adds up to ${a.in + a.out}, the summary to ${kinds}`);
      if (next !== undefined && next.opening[pot] !== s.closing[pot]) problems.push(`${where}: ends with ${s.closing[pot]}, the next starts with ${next.opening[pot]}`);
    }
  }
  return problems;
}
