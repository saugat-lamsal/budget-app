import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { MOVABLE_POTS, type Book } from '@budget-app/money';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemoServer } from '../src/demo/demo-server.js';
import { DEMO_SCENARIOS, demoBook, demoScenario } from '../src/demo/scenarios.js';
import { POT_SLUGS, type ActivityView } from '../src/views/activity.js';
import type { ChoiceResponse, MoveResponse } from '../src/views/choice.js';
import type { PaydayView } from '../src/views/payday.js';

// The demo on the screens of Phase 4 step 5: what went in and out of a
// bucket, hand moves, and Payday. Made-up lives only.

function bookOf(name: string): Book {
  const book = demoBook(name);
  if (book === null) throw new Error(`no book for the made-up life ${name}`);
  return book;
}

describe('the made-up life "activity-busy": every kind of row on the lists', () => {
  it('it agrees with its made-up bank, and says its numbers are made up (12.3)', () => {
    const input = demoScenario('activity-busy')!.input!();
    expect(input.madeUpData).toBe(true);
    expect(input.book!.selfCheck(input.bank!).ok).toBe(true);
  });

  it('B97 B98 the lists have a paycheck, purchases, a split, money in, held for others, mom, a hand move, and a leftover', () => {
    const book = bookOf('activity-busy');
    const whats = new Set(MOVABLE_POTS.flatMap((pot) => book.activity(pot).rows.map((r) => r.what)));
    for (const what of ['paycheck', 'purchase', 'payback', 'other-income', 'not-mine', 'person-payment', 'mom', 'move', 'leftover', 'card-fee']) {
      expect([...whats], what).toContain(what);
    }
    expect(MOVABLE_POTS.flatMap((pot) => book.activity(pot).rows).some((r) => r.partOfSplit)).toBe(true);
    expect(MOVABLE_POTS.flatMap((pot) => book.activity(pot).rows).some((r) => r.refunded > 0)).toBe(true);
    expect(MOVABLE_POTS.flatMap((pot) => book.activity(pot).rows).some((r) => r.pending)).toBe(true);
  });

  it('B97 B4 a charge pending before payday that posted after it with a tip is a small row in this pay period, dated the day of the purchase', () => {
    const wants = bookOf('activity-busy').activity('wants');
    const tip = wants.rows.find((r) => r.what === 'purchase' && r.date === '2026-10-01');
    expect(tip).toMatchObject({ description: 'BLUE DOOR COFFEE', amount: -125, pending: false });
  });

  it('B97 every bucket\'s list adds up', () => {
    const book = bookOf('activity-busy');
    for (const pot of MOVABLE_POTS) {
      const a = book.activity(pot);
      expect(a.opening + a.in + a.out).toBe(a.closing);
      expect(a.closing).toBe(book.pots()[pot]);
    }
  });

  it('B100 there are rows that can be sorted again and rows that cannot, on the same list', () => {
    const rows = bookOf('activity-busy').activity('needs').rows;
    expect(rows.some((r) => r.resort.resortable)).toBe(true);
    expect(rows.some((r) => !r.resort.resortable)).toBe(true);
  });
});

describe('the made-up life "payday-paid": the second paycheck has just come in', () => {
  it('it agrees with its made-up bank, with the savings account short by the new paycheck\'s share (3.8, 12.3)', () => {
    const input = demoScenario('payday-paid')!.input!();
    const book = input.book!;
    expect(book.selfCheck(input.bank!).ok).toBe(true);
    const move = book.savingsTransfer(input.bank!.savings);
    const last = book.paychecks().at(-1)!.split;
    expect(move.stillToMove).toBe(last.savings + last.momReserve);
    expect(move.stillToMove).toBeGreaterThan(0);
  });

  it('B104 the second paycheck started the pay period, and part of the mom reserve did not fit under the cap', () => {
    const book = bookOf('payday-paid');
    expect(book.period().number).toBe(2);
    expect(book.paydayReport().paycheck).toMatchObject({ date: '2026-10-16', takenBack: false });
    expect(book.paydayReport().paycheck!.split.detail.overflowToSavings).toBeGreaterThan(0);
  });

  it('3.4 B106 both leftover questions are open, and the pay period that ended has spending and a mom payment to sum up (B105)', () => {
    const report = bookOf('payday-paid').paydayReport();
    expect(report.leftovers.map((l) => l.outcome)).toEqual(['waiting', 'waiting']);
    expect(report.ended).toMatchObject({ number: 1, startDate: '2026-10-02', endDate: '2026-10-16' });
    expect(report.ended!.byKind.needs.spending).toBeLessThan(0);
    expect(report.ended!.byKind.wants.spending).toBeLessThan(0);
    expect(report.ended!.byKind.momReserve.mom).toBe(-50_000);
  });
});

describe('the demo server serves the new screens', () => {
  let server: Server;
  let base = '';
  beforeAll(async () => {
    server = createDemoServer({ webRoot: fileURLToPath(new URL('../../web/dist/', import.meta.url)), onError: () => undefined });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });

  const cookie = (life: string): Record<string, string> => ({ Cookie: `demo=${life}` });
  const get = (path: string, life: string) => fetch(`${base}${path}`, { headers: cookie(life) });
  async function post(life: string, body: unknown): Promise<{ status: number; json: ChoiceResponse & MoveResponse }> {
    const res = await fetch(`${base}/api/choice`, { method: 'POST', headers: { ...cookie(life), 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as ChoiceResponse & MoveResponse };
  }
  const reset = (life: string) => fetch(`${base}/demo/${life}`, { redirect: 'manual' });

  it('B97 B104 the activity of every bucket and Payday are served for every made-up life that can load', async () => {
    for (const s of DEMO_SCENARIOS) {
      // The slow life takes its time on purpose.
      if (s.delayMs !== undefined) continue;
      const slugs = Object.keys(POT_SLUGS);
      for (const path of [...slugs.map((slug) => `/api/activity/${slug}`), '/api/payday']) {
        const res = await get(path, s.name);
        if (s.input === null) {
          expect(res.status, `${s.name} ${path}`).toBe(500);
          continue;
        }
        expect(res.status, `${s.name} ${path}`).toBe(200);
        const view = (await res.json()) as ActivityView | PaydayView;
        expect(view.madeUpData, `${s.name} ${path}`).toBe(true);
        expect(view.state, `${s.name} ${path}`).toBe(s.name === 'not-set-up' ? 'not-set-up' : 'tracking');
      }
    }
  }, 60_000);

  it('4.7 B100 a purchase sorted again from the list stays sorted again, and the list changes right away', async () => {
    await reset('activity-busy');
    const book = bookOf('activity-busy');
    // A whole purchase (not a part of a split, whose whole amount would move).
    const row = book.activity('needs').rows.find((r) => r.resort.resortable && r.what === 'purchase' && !r.partOfSplit && r.refunded === 0 && r.resort.options.picks.some((p) => p.to === 'wants'));
    expect(row).toBeDefined();
    const sent = await post('activity-busy', { id: 'resort-decision-1', item: row!.id, choice: { to: 'wants' }, resort: true });
    expect(sent.status).toBe(200);
    const after = (await (await get('/api/activity/needs', 'activity-busy')).json()) as Extract<ActivityView, { state: 'tracking' }>;
    expect(after.activity.rows.find((r) => r.id === row!.id)).toBeUndefined();
    expect(after.activity.closing).toBe(book.pots().needs + (row!.amount < 0 ? -row!.amount : 0));
    const wants = (await (await get('/api/activity/wants', 'activity-busy')).json()) as Extract<ActivityView, { state: 'tracking' }>;
    expect(wants.activity.rows.find((r) => r.id === row!.id)?.amount).toBe(row!.amount);
    // Sent again with the same decision number: the same answer, nothing changed twice.
    const again = await post('activity-busy', { id: 'resort-decision-1', item: row!.id, choice: { to: 'wants' }, resort: true });
    expect(again.json).toMatchObject({ ok: true, replayed: true });
    // Picking the life again starts it over.
    await reset('activity-busy');
    const fresh = (await (await get('/api/activity/needs', 'activity-busy')).json()) as Extract<ActivityView, { state: 'tracking' }>;
    expect(fresh.activity.rows.find((r) => r.id === row!.id)).toBeDefined();
  });

  it('13.3 13.4 B103 a hand move stays made; out of savings it asks first, and nothing moves until he says yes', async () => {
    await reset('normal');
    const before = bookOf('normal').pots();
    const ok = await post('normal', { id: 'move-decision-1', move: { from: 'wants', to: 'needs', amount: 5_000 } });
    expect(ok).toMatchObject({ status: 200, json: { ok: true, moved: { from: 'wants', to: 'needs', amount: 5_000 } } });
    const asked = await post('normal', { id: 'move-decision-2', move: { from: 'savings', to: 'needs', amount: 10_000 } });
    expect(asked.status).toBe(422);
    expect(asked.json).toMatchObject({ ok: false, code: 'needs-confirmation', reasons: ['out-of-savings'] });
    const needs = (await (await get('/api/activity/needs', 'normal')).json()) as Extract<ActivityView, { state: 'tracking' }>;
    expect(needs.activity.closing).toBe(before.needs + 5_000);
    const yes = await post('normal', { id: 'move-decision-2', move: { from: 'savings', to: 'needs', amount: 10_000 }, confirmed: true });
    expect(yes.status).toBe(200);
    const savings = (await (await get('/api/activity/savings', 'normal')).json()) as Extract<ActivityView, { state: 'tracking' }>;
    expect(savings.activity.closing).toBe(before.savings - 10_000);
    await reset('normal');
  });

  it('3.4 B107 a payday question answered on Payday is answered in Review too', async () => {
    await reset('payday-paid');
    const payday = (await (await get('/api/payday', 'payday-paid')).json()) as Extract<PaydayView, { state: 'tracking' }>;
    const q = payday.questions[0]!;
    const sent = await post('payday-paid', { id: 'leftover-decision-1', item: q.item.id, choice: { leftover: 'roll-over' }, confirmed: true });
    expect(sent.status).toBe(200);
    const review = (await (await get('/api/review', 'payday-paid')).json()) as { items: { item: { id: string } }[] };
    expect(review.items.map((i) => i.item.id)).not.toContain(q.item.id);
    const after = (await (await get('/api/payday', 'payday-paid')).json()) as Extract<PaydayView, { state: 'tracking' }>;
    expect(after.questions.map((x) => x.item.id)).not.toContain(q.item.id);
    expect(after.report.leftovers.find((l) => l.question === null && l.outcome === 'kept')).toBeDefined();
    await reset('payday-paid');
  });

  it('a move before setup day finds nothing to move, and changes nothing', async () => {
    const res = await post('not-set-up', { id: 'move-decision-3', move: { from: 'wants', to: 'needs', amount: 5_000 } });
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ ok: false });
  });
});
