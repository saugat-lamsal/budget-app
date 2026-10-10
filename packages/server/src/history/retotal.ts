import { createHash } from 'node:crypto';
import { DEFAULT_SETTINGS, type IsoDate } from '@budget-app/money';
import type { Db } from '../db/database.js';
import { saveServerLine } from '../server-log.js';
import { sameTotals, type Totals } from './history.js';
import { describeEvent, readHistory, replayEach, type StoredEvent } from './history-db.js';
import { todayIn } from './today.js';

// QUESTIONS.md A28, his answer (option 1): when the history no longer replays
// to the totals saved with it, the server stays stopped. A separate command
// (npm run replay-check) shows each event whose totals would change, before
// and after, and with his yes takes the new totals from that event on. It
// goes in the change log (13.5), dated, with what changed.
//
// That is for a real fix to the money math that changes what an old event
// does. Nothing about money changes without him seeing it first, and the past
// stays explained.

export interface ChangedEvent {
  readonly seq: number;
  readonly date: IsoDate;
  // What the event was, in words.
  readonly what: string;
  // The totals saved with it, and what it replays to now.
  readonly before: Totals | null;
  readonly after: Totals | null;
}

export type RetotalCheck =
  // Every event replays to what was saved: nothing to do.
  | { readonly state: 'same' }
  // Some events replay to other totals. key names exactly this list, so a yes
  // is for what he saw.
  | { readonly state: 'changed'; readonly events: readonly ChangedEvent[]; readonly key: string }
  // An event the code refuses now. New totals cannot fix that, so nothing can
  // be taken (QUESTIONS.md A30).
  | { readonly state: 'cannot-replay'; readonly at: { readonly seq: number; readonly date: IsoDate; readonly what: string }; readonly why: string };

// Replays the whole history and compares each event's totals with the ones
// saved with it. Reads only.
export function checkRetotal(db: Db): RetotalCheck {
  const { afterBookLines: _lines, timeZone: _zone, ...found } = check(readHistory(db));
  return found;
}

function check(events: readonly StoredEvent[]): RetotalCheck & { readonly afterBookLines?: number; readonly timeZone?: string } {
  const changed: ChangedEvent[] = [];
  const replayed = replayEach(events, (stored, totals) => {
    if (stored.sealed && !sameTotals(stored.totals, totals)) changed.push({ seq: stored.seq, date: stored.date, what: describeEvent(stored), before: stored.totals, after: totals });
  });
  if (!replayed.ok) return { state: 'cannot-replay', at: { seq: replayed.at.seq, date: replayed.at.date, what: describeEvent(replayed.at) }, why: replayed.why };
  const book = replayed.replayed.book;
  const extra = { afterBookLines: book?.changeLog().length ?? 0, timeZone: (book?.settings() ?? DEFAULT_SETTINGS).homeTimeZone };
  if (changed.length === 0) return { state: 'same', ...extra };
  return { state: 'changed', events: changed, key: keyOf(changed), ...extra };
}

function keyOf(events: readonly ChangedEvent[]): string {
  return createHash('sha256').update(JSON.stringify(events)).digest('hex').slice(0, 16);
}

export type RetotalAnswer = { readonly ok: true; readonly events: number } | { readonly ok: false; readonly why: string };

// With his yes to the list named by key: the new totals are saved for every
// event that changed, and the change log says so, dated today in his home
// time zone. All in one step. Refused, with nothing changed, if the history
// no longer comes to that list.
export function acceptRetotal(db: Db, key: string, now: Date): RetotalAnswer {
  return db.transaction((): RetotalAnswer => {
    const found = check(readHistory(db));
    if (found.state === 'same') return { ok: false, why: 'Every event replays to what was saved. Nothing was changed.' };
    if (found.state === 'cannot-replay') return { ok: false, why: `Event ${found.at.seq} cannot be replayed now: ${found.why}. Nothing was changed.` };
    if (found.key !== key) return { ok: false, why: 'The history changed since you looked. Nothing was changed; run it again.' };
    const update = db.prepare('UPDATE book_events SET totals = ? WHERE seq = ?');
    for (const e of found.events) update.run(JSON.stringify(e.after), e.seq);
    const first = found.events[0];
    if (first === undefined) throw new Error('a change with no events');
    saveServerLine(db, {
      date: todayIn(found.timeZone ?? DEFAULT_SETTINGS.homeTimeZone, now),
      action: 'history-retotaled',
      from: { seq: first.seq, date: first.date, what: first.what },
      events: found.events.map((e) => ({ seq: e.seq, date: e.date, what: e.what, before: e.before, after: e.after })),
      afterBookLines: found.afterBookLines ?? 0,
    });
    return { ok: true, events: found.events.length };
  })();
}
