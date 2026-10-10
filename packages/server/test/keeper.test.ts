import { describe, expect, it } from 'vitest';
import type { Keeper } from '../src/history/keeper.js';
import { readHistory } from '../src/history/history-db.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { choose, decision, decisions, lifeInAFile, noonInNewYork, screens, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// The real server keeps everything (Step 1): after every single step of a
// busy life, the books opened again from the database are exactly the books
// that were running: every screen's numbers, every bucket, the review list,
// the change log, each bucket's list, Payday, Settings, and Setup day.
// Every name and number is made up.

const C = ACCOUNT_IDS.checking;
const E = ACCOUNT_IDS.everyday;

function ok<R extends { readonly ok: boolean }>(answer: R, what: string): R {
  if (!answer.ok) throw new Error(`${what} was refused: ${JSON.stringify(answer)}`);
  return answer;
}

// A settings change that asks first: his yes names the preview he saw.
function settingsYes(keeper: Keeper, settings: Parameters<Keeper['settingsChange']>[0]['settings'], id = decision()): void {
  const asked = keeper.settingsChange({ id, settings });
  if (asked.ok) return;
  if (asked.code !== 'needs-confirmation' || asked.preview === undefined) throw new Error(`settings refused: ${asked.why}`);
  ok(keeper.settingsChange({ id, settings, confirmed: true, seen: asked.preview.key }), 'the settings change');
}

function bankRuleYes(keeper: Keeper, bankRule: Parameters<Keeper['bankRule']>[0]['bankRule'], id = decision()): void {
  const asked = keeper.bankRule({ id, bankRule });
  if (asked.ok || asked.preview === undefined) throw new Error(`the bank rule did not ask first: ${JSON.stringify(asked)}`);
  ok(keeper.bankRule({ id, bankRule, confirmed: true, seen: asked.preview.key }), 'the bank rule');
}

const waitingId = (keeper: Keeper, description: string): string => {
  const item = keeper.book()?.reviewItems().find((i) => 'description' in i && i.description === description);
  if (item === undefined) throw new Error(`nothing waiting called ${description}`);
  return item.id;
};

const leftoverId = (keeper: Keeper, bucket: 'needs' | 'wants'): string => {
  const item = keeper.book()?.reviewItems().find((i) => i.type === 'leftover' && i.bucket === bucket);
  if (item === undefined) throw new Error(`no ${bucket} leftover question`);
  return item.id;
};

// The steps of a busy life, from before setup day to a few weeks in: Setup
// day answers, bank activity, and every kind of answer.
// Its decision numbers are its own, the same in every life given these steps.
function busySteps(life: Life): (readonly [string, () => unknown])[] {
  const k = (): Keeper => life.keeper;
  const decision = decisions('busy');
  const day = (d: string): void => {
    life.now = noonInNewYork(d);
  };
  return [
    ['setup day: the last paycheck', () => ok(k().setup({ id: decision(), setup: { lastPaycheck: '2026-09-25' } }), 'the last paycheck')],
    ['setup day: savings', () => ok(k().setup({ id: decision(), setup: { assign: { pot: 'savings', amount: 400_000 } } }), 'savings')],
    ['setup day: a bank rule added on Setup day', () => bankRuleYes(k(), { add: { account: 'checking', contains: 'MADE UP GYM', means: 'payment-to-person' } }, decision())],
    ['setup day: the mom reserve and wants', () => {
      ok(k().setup({ id: decision(), setup: { assign: { pot: 'momReserve', amount: 100_000 } } }), 'the reserve');
      ok(k().setup({ id: decision(), setup: { assign: { pot: 'wants', amount: 20_000 } } }), 'wants');
    }],
    ['setup day: the rest in needs, and tracking starts', () => {
      ok(k().setup({ id: decision(), setup: { assign: { pot: 'needs', rest: true } } }), 'needs');
      const view = k().setupView();
      if (view.state !== 'not-set-up' || !view.ready) throw new Error('not ready');
      ok(k().setup({ id: decision(), setup: { start: true }, confirmed: true, seen: view.key }), 'starting');
    }],
    ['the bank: purchases, a payment to a person, a gym payment', async () => {
      day('2026-10-03');
      life.h.fake.addPosted({ id: 'store-1', account: E, amount: 2_345, date: '2026-10-02', description: 'CORNER STORE 12' });
      life.h.fake.addPosted({ id: 'coffee-1', account: E, amount: 675, date: '2026-10-02', description: 'COFFEE SHOP 5' });
      life.h.fake.addPending({ id: 'diner-1', account: E, amount: 1_800, date: '2026-10-03', description: 'HARBOR DINER' });
      life.h.fake.addPosted({ id: 'anna-1', account: C, amount: 6_000, date: '2026-10-03', description: 'Zelle payment to ANNA MADEUP' });
      life.h.fake.addPosted({ id: 'gym-1', account: C, amount: 4_000, date: '2026-10-03', description: 'MADE UP GYM' });
      await life.sync();
    }],
    ['a purchase sorted to wants', () => ok(choose(k(), { item: waitingId(k(), 'CORNER STORE 12'), choice: { to: 'wants' } }, decision()), 'sorting')],
    ['a payment to a person split', () => ok(choose(k(), { item: 'anna-1', choice: { split: [{ bucket: 'needs', amount: 1_000 }, { bucket: 'not-mine', amount: 'rest' }] } }, decision()), 'the split')],
    ['always do this', () => ok(choose(k(), { item: waitingId(k(), 'COFFEE SHOP 5'), choice: { to: 'wants' }, always: { contains: 'COFFEE' } }, decision()), 'always')],
    ['the paycheck rule, asked first with what it would do', () => settingsYes(k(), { paycheckRule: { contains: 'MADEUP CORP PAYROLL' } }, decision())],
    ['the bank: the pending charge posts with a tip, and a paycheck comes', async () => {
      day('2026-10-09');
      life.h.fake.postPending('diner-1', { id: 'diner-1-posted', date: '2026-10-05', amount: 2_100 });
      life.h.fake.addPosted({ id: 'pay-1', account: C, amount: -250_000, date: '2026-10-09', description: 'MADEUP CORP PAYROLL' });
      await life.sync();
    }],
    ['a leftover question answered', () => ok(choose(k(), { item: leftoverId(k(), 'wants'), choice: { leftover: 'roll-over' } }, decision()), 'the leftover')],
    ['the other leftover moved to savings', () => ok(choose(k(), { item: leftoverId(k(), 'needs'), choice: { leftover: 'move-to-savings' } }, decision()), 'the leftover')],
    ['money moved by hand, and out of savings with his yes', () => {
      ok(k().move({ id: decision(), move: { from: 'wants', to: 'needs', amount: 1_000 } }), 'the move');
      const id = decision();
      const asked = k().move({ id, move: { from: 'savings', to: 'wants', amount: 500 } });
      expect(asked).toMatchObject({ ok: false, code: 'needs-confirmation' });
      ok(k().move({ id, move: { from: 'savings', to: 'wants', amount: 500 }, confirmed: true }), 'the move out of savings');
    }],
    ['sorting rules added, changed, moved, and one removed', () => {
      ok(k().ruleChange({ id: decision(), rule: { add: { for: 'purchase', contains: 'DINER', to: 'wants' } } }), 'a rule');
      ok(k().ruleChange({ id: decision(), rule: { add: { for: 'purchase', contains: 'HARBOR', to: 'needs' } } }), 'a second rule');
      const harbor = k().book()?.rules().find((r) => r.contains === 'HARBOR');
      if (harbor === undefined) throw new Error('no rule');
      ok(k().ruleChange({ id: decision(), rule: { move: { id: harbor.id, direction: 'up' } } }), 'moving it');
      ok(k().ruleChange({ id: decision(), rule: { change: { id: harbor.id, for: 'purchase', contains: 'HARBOR DINER', to: 'needs' } } }), 'changing it');
      const id = decision();
      k().ruleChange({ id, rule: { remove: harbor.id } });
      ok(k().ruleChange({ id, rule: { remove: harbor.id }, confirmed: true }), 'removing it');
    }],
    ['a settings change, and the home time zone', () => {
      settingsYes(k(), { lowBucketAlertPercent: 25, split: { savings: 40, needs: 40, wants: 20 } }, decision());
      settingsYes(k(), { homeTimeZone: 'America/Chicago' }, decision());
    }],
    ['the bank takes back a purchase it had counted; he marks it seen', async () => {
      day('2026-10-12');
      life.h.fake.removePosted('store-1', { keepBalance: false });
      await life.sync();
      const taken = k().book()?.changeLog().find((e) => e.kind === 'bank-took-back');
      if (taken?.kind !== 'bank-took-back') throw new Error('nothing taken back');
      expect(k().seen({ kind: 'bank-took-back', id: taken.id })).toBe(true);
    }],
    ['a bank rule added and moved on Settings, then the mom rule set', async () => {
      bankRuleYes(k(), { add: { account: 'checking', contains: 'Zelle payment to MOM', means: 'payment-to-person' } }, decision());
      settingsYes(k(), { momRule: { contains: 'Zelle payment to MOM MADEUP' } }, decision());
      day('2026-10-14');
      life.h.fake.addPosted({ id: 'mom-1', account: C, amount: 30_000, date: '2026-10-14', description: 'Zelle payment to MOM MADEUP' });
      life.h.fake.addPosted({ id: 'gym-2', account: C, amount: 4_000, date: '2026-10-14', description: 'MADE UP GYM' });
      await life.sync();
    }],
    ["the gym payment marked a transfer between his accounts, and a purchase sorted again from its bucket's list", () => {
      ok(choose(k(), { item: 'gym-2', choice: { transfer: 'savings' } }, decision()), 'marking it');
      ok(choose(k(), { item: 'coffee-1', choice: { to: 'needs' }, resort: true }, decision()), 'sorting it again');
    }],
  ];
}

describe('the real server keeps everything: a restart finds the books exactly as they were', () => {
  it('after every single step of a busy life, the books opened again from the database equal the running ones, screen by screen', async () => {
    const life = await lifeInAFile();
    try {
      for (const [name, step] of busySteps(life)) {
        await step();
        const again = life.reopen();
        try {
          expect(screens(again.keeper), name).toEqual(screens(life.keeper));
        } finally {
          again.close();
        }
      }
      // Something of every kind is in the history.
      const answers = readHistory(life.h.db).flatMap((e) => (e.event.kind === 'answer' ? [e.event.answer] : []));
      const methods = new Set(answers.flatMap((a) => (a.book ?? []).map((c) => c.method)));
      expect([...methods].sort()).toEqual(['answerLeftover', 'changeRule', 'changeSettings', 'moveMoney', 'moveRule', 'removeRule', 'addRule', 'sort', 'sortAlways'].sort());
      expect(answers.some((a) => a.seen !== undefined)).toBe(true);
      expect(answers.some((a) => a.setup !== undefined)).toBe(true);
      expect(answers.filter((a) => a.bankRules !== undefined)).toHaveLength(2);
    } finally {
      life.done();
    }
  }, 120_000);

  it('a real restart in the middle of it all, then more answers: the same books as a life that never stopped', async () => {
    const stopping = await lifeInAFile();
    const steady = await lifeInAFile();
    try {
      const a = busySteps(stopping);
      const b = busySteps(steady);
      for (let i = 0; i < a.length; i += 1) {
        await a[i]![1]();
        await b[i]![1]();
        if (i % 3 === 2) stopping.restart();
        expect(screens(stopping.keeper), a[i]![0]).toEqual(screens(steady.keeper));
      }
    } finally {
      stopping.done();
      steady.done();
    }
  }, 120_000);
});

describe('what Setup day and the bank rules leave behind is kept too', () => {
  it('14.2 A10 a charge pending on Setup day, through the screens, that posts with a tip after a restart: only the tip waits in review, as with the database wrapper', async () => {
    const pendingOnSetupDay = (fake: Life['h']['fake']): void => {
      fake.addPending({ id: 'gas-1', account: C, amount: 4_000, date: '2026-09-30', description: 'GAS STATION 77' });
    };
    const life = await lifeInAFile({ history: pendingOnSetupDay });
    try {
      expect(setUpThroughTheDesk(life)).toMatchObject({ ok: true });
      life.restart();
      life.now = noonInNewYork('2026-10-03');
      life.h.fake.postPending('gas-1', { id: 'gas-1-posted', date: '2026-10-02', amount: 4_550 });
      await life.sync();
      const waiting = life.keeper.book()?.reviewItems() ?? [];
      expect(waiting.map((i) => ('amount' in i ? i.amount : null))).toEqual([550]);
      expect(life.keeper.book()?.pots().unsortedOut).toBe(550);
    } finally {
      life.done();
    }
  });

  it('section 2 13.5 a bank rule changed on Settings is in the change log after a restart, among the others, in the order made', async () => {
    const life = await lifeInAFile();
    try {
      setUpThroughTheDesk(life);
      ok(life.keeper.move({ id: decision(), move: { from: 'wants', to: 'needs', amount: 100 } }), 'a move');
      bankRuleYes(life.keeper, { add: { account: 'checking', contains: 'MADE UP GYM', means: 'payment-to-person' } });
      const before = life.keeper.settings();
      if (before.state !== 'tracking') throw new Error('not tracking');
      expect(before.log.map((l) => l.kind).slice(0, 2)).toEqual(['bank-rule-added', 'money-moved']);
      life.restart();
      expect(life.keeper.settings()).toEqual(before);
    } finally {
      life.done();
    }
  });
});

describe('a decision number and its first answer are saved in the same step', () => {
  it('after a restart, the same request gets its first answer back and changes nothing; another request with the number is refused', async () => {
    const life = await lifeInAFile();
    try {
      expect(setUpThroughTheDesk(life)).toMatchObject({ ok: true });
      life.now = noonInNewYork('2026-10-03');
      life.h.fake.addPosted({ id: 'store-1', account: E, amount: 2_345, date: '2026-10-02', description: 'CORNER STORE 12' });
      await life.sync();
      const id = decision();
      const first = life.keeper.choice({ id, item: 'store-1', choice: { to: 'wants' } });
      expect(first).toMatchObject({ ok: true, replayed: false });
      const events = readHistory(life.h.db).length;
      life.restart();
      const again = life.keeper.choice({ id, item: 'store-1', choice: { to: 'wants' } });
      expect(again).toEqual({ ...first, replayed: true });
      // Written the other way round, it is the same request.
      expect(life.keeper.choice({ choice: { to: 'wants' }, item: 'store-1', id } as never)).toEqual({ ...first, replayed: true });
      expect(life.keeper.choice({ id, item: 'store-1', choice: { to: 'needs' }, resort: true })).toEqual({ ok: false, code: 'id-reused', why: 'That decision number was already used for a different choice. Nothing was changed.' });
      expect(life.keeper.move({ id, move: { from: 'wants', to: 'needs', amount: 100 } })).toEqual({ ok: false, code: 'id-reused', why: 'That decision number was already used for a different move. Nothing was changed.' });
      expect(readHistory(life.h.db)).toHaveLength(events);
      expect(life.keeper.book()?.pots().wants).toBe(20_000 - 2_345);
    } finally {
      life.done();
    }
  });

  it('a refusal is not kept: the same decision number sent again with his yes goes through, once', async () => {
    const life = await lifeInAFile();
    try {
      setUpThroughTheDesk(life);
      const id = decision();
      expect(life.keeper.move({ id, move: { from: 'savings', to: 'wants', amount: 500 } })).toMatchObject({ ok: false, code: 'needs-confirmation' });
      const events = readHistory(life.h.db).length;
      life.restart();
      expect(life.keeper.move({ id, move: { from: 'savings', to: 'wants', amount: 500 }, confirmed: true })).toMatchObject({ ok: true, replayed: false });
      expect(life.keeper.move({ id, move: { from: 'savings', to: 'wants', amount: 500 }, confirmed: true })).toMatchObject({ ok: true, replayed: true });
      expect(readHistory(life.h.db)).toHaveLength(events + 1);
    } finally {
      life.done();
    }
  });

  it('a save stopped halfway saves nothing at all, the running books are as before, and the same decision sent again does it once', async () => {
    let stop = false;
    const life = await lifeInAFile({
      beforeCommit: () => {
        if (stop) throw new Error('the power went out (made up)');
      },
    });
    try {
      // Before setup day: a Setup day answer stopped halfway is not kept either.
      const setupBefore = screens(life.keeper);
      stop = true;
      expect(() => life.keeper.setup({ id: decision(), setup: { lastPaycheck: '2026-09-25' } })).toThrow('the power went out');
      stop = false;
      expect(readHistory(life.h.db)).toEqual([]);
      expect(screens(life.keeper)).toEqual(setupBefore);
      setUpThroughTheDesk(life);
      life.now = noonInNewYork('2026-10-03');
      life.h.fake.addPosted({ id: 'store-1', account: E, amount: 2_345, date: '2026-10-02', description: 'CORNER STORE 12' });
      await life.sync();
      const before = screens(life.keeper);
      const events = readHistory(life.h.db).length;
      const decisions = life.h.db.prepare('SELECT COUNT(*) AS n FROM decisions').get();
      const id = decision();
      for (const send of [
        () => life.keeper.choice({ id, item: 'store-1', choice: { to: 'wants' } }),
        () => life.keeper.move({ id: decision(), move: { from: 'wants', to: 'needs', amount: 100 } }),
        () => life.keeper.ruleChange({ id: decision(), rule: { add: { for: 'purchase', contains: 'CORNER', to: 'needs' } } }),
        () => life.keeper.settingsChange({ id: decision(), settings: { lowBucketAlertPercent: 30 } }),
      ]) {
        stop = true;
        expect(send).toThrow('the power went out');
        stop = false;
        expect(readHistory(life.h.db)).toHaveLength(events);
        expect(life.h.db.prepare('SELECT COUNT(*) AS n FROM decisions').get()).toEqual(decisions);
        expect(screens(life.keeper)).toEqual(before);
      }
      const done = life.keeper.choice({ id, item: 'store-1', choice: { to: 'wants' } });
      expect(done).toMatchObject({ ok: true, replayed: false });
      expect(life.keeper.choice({ id, item: 'store-1', choice: { to: 'wants' } })).toEqual({ ...done, replayed: true });
      expect(readHistory(life.h.db)).toHaveLength(events + 1);
      expect(life.keeper.book()?.pots().wants).toBe(20_000 - 2_345);
    } finally {
      life.done();
    }
  });
});
