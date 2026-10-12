import { DEFAULT_SETTINGS, type Book, type Settings } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { MOM_NAME, PAYROLL, deposit, openTestBook, payPerson, paycheck, purchase } from '../../money/test/helpers.js';
import { ChoiceDesk, parseRequest, parseRuleRequest, parseSettingsRequest } from '../src/choices.js';
import type { RuleRequest, RuleResponse, SettingsRequest, SettingsResponse } from '../src/views/choice.js';

// Settings and sorting rules changed from the Settings screen (section 2;
// rules 13.1, 13.2, 13.5; QUESTIONS.md A9). The change reaches the books the
// same way a tap in Review does: the money math checks and applies it, a
// repeat of the same decision changes nothing, and a refusal changes nothing
// and says why. What sorts waiting items for good asks first, and shows what
// it would do, from the money math, before the yes.

const TODAY = '2026-10-20';

function setup(options: Parameters<typeof openTestBook>[0] = {}): { book: Book; desk: ChoiceDesk } {
  const book = openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 150_000, heldForOthers: 0 }, ...options });
  return { book, desk: new ChoiceDesk(book, () => TODAY) };
}

// The first sync: no paycheck rule or mom rule yet, a paycheck and a payment to mom waiting.
function firstSync(): { book: Book; desk: ChoiceDesk } {
  const s = setup({ settings: { paycheckRule: null, momRule: null, leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } } });
  s.book.receive(paycheck('p1', '2026-10-09', 400_000));
  s.book.receive(payPerson('z1', '2026-10-10', 20_000, MOM_NAME));
  return s;
}

let counter = 0;
const nextId = (): string => `change-${String((counter += 1)).padStart(8, '0')}`;
const settings = (patch: Partial<Settings>, over: Partial<SettingsRequest> = {}): SettingsRequest => ({ id: nextId(), settings: patch, ...over });
const rule = (edit: RuleRequest['rule'], over: Partial<RuleRequest> = {}): RuleRequest => ({ id: nextId(), rule: edit, ...over });

function snapshot(b: Book): string {
  return JSON.stringify({ pots: b.pots(), review: b.reviewItems(), log: b.changeLog(), settings: b.settings(), inForce: b.splitInForce(), rules: b.rules(), period: b.period(), paychecks: b.paychecks(), purchases: b.purchases() });
}

function done<T extends SettingsResponse | RuleResponse>(response: T): Extract<T, { ok: true }> {
  if (!response.ok) throw new Error(`refused: ${response.code}: ${response.why}`);
  return response as Extract<T, { ok: true }>;
}

function refused<T extends SettingsResponse | RuleResponse>(response: T): Extract<T, { ok: false }> {
  if (response.ok) throw new Error('expected a refusal');
  return response as Extract<T, { ok: false }>;
}

describe('section 2 reading what the phone sent: a settings change', () => {
  it('2 takes a change to any setting, exactly as sent', () => {
    const patch: Partial<Settings> = {
      split: { savings: 40, needs: 40, wants: 20 },
      momReservePerPaycheck: 100_000,
      momReserveCap: 250_000,
      momMonthlyTarget: { low: 150_000, high: 250_000 },
      lowBucketAlertPercent: 25,
      cardReminderDaysBefore: [10, 3, 1],
      dailyReviewTime: '21:30',
      leftoverAtPayday: { needs: 'roll-over', wants: 'move-to-savings' },
      oldCardPromoEndDate: '2027-03-31',
      paycheckRule: { contains: 'MADE UP EMPLOYER' },
      payScheduleDays: 7,
      momRule: null,
      earlyPaycheckDays: 5,
      homeTimeZone: 'America/Chicago',
      quietHours: { from: '23:00', to: '06:00' },
      bankNotReadAlertHours: 36,
      amountsOnLockScreen: true,
      bankPermissionWarnDays: 10,
    };
    expect(Object.keys(patch).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    const request = { id: 'abcdefgh', settings: patch, confirmed: true, seen: '0123456789abcdef'.repeat(2) };
    expect(parseSettingsRequest(request)).toEqual(request);
    expect(parseRequest(request)).toEqual(request);
  });

  it('2 the text of the paycheck rule and the mom rule is trimmed', () => {
    expect(parseSettingsRequest({ id: 'abcdefgh', settings: { paycheckRule: { contains: '  ACME  ' } } })).toEqual({ id: 'abcdefgh', settings: { paycheckRule: { contains: 'ACME' } } });
  });

  it.each([
    ['no settings at all', { id: 'abcdefgh', settings: {} }],
    ['a setting that does not exist', { id: 'abcdefgh', settings: { safeToSpend: 1 } }],
    ['a fraction of a cent', { id: 'abcdefgh', settings: { momReserveCap: 1.5 } }],
    ['a percent that is not whole', { id: 'abcdefgh', settings: { split: { savings: 49.5, needs: 30.5, wants: 20 } } }],
    ['a split with a part missing', { id: 'abcdefgh', settings: { split: { savings: 80, needs: 20 } } }],
    ['a split whose last part is not a number', { id: 'abcdefgh', settings: { split: { savings: 50, needs: 30, wants: '20' } } }],
    ['a split whose last part is empty', { id: 'abcdefgh', settings: { split: { savings: 50, needs: 30, wants: null } } }],
    ['a split with an extra part', { id: 'abcdefgh', settings: { split: { savings: 50, needs: 30, wants: 20, mom: 0 } } }],
    ['an amount as text', { id: 'abcdefgh', settings: { momReservePerPaycheck: '1500.00' } }],
    ['a target with no high end', { id: 'abcdefgh', settings: { momMonthlyTarget: { low: 1 } } }],
    ['reminder days that are not a list', { id: 'abcdefgh', settings: { cardReminderDaysBefore: 7 } }],
    ['too many reminder days', { id: 'abcdefgh', settings: { cardReminderDaysBefore: Array.from({ length: 31 }, (_, i) => i) } }],
    ['a leftover choice that is not one', { id: 'abcdefgh', settings: { leftoverAtPayday: { needs: 'spend-it', wants: 'ask' } } }],
    ['a date that is not text', { id: 'abcdefgh', settings: { oldCardPromoEndDate: 20270331 } }],
    ['a rule with no text', { id: 'abcdefgh', settings: { paycheckRule: { contains: '   ' } } }],
    ['a rule with too much text', { id: 'abcdefgh', settings: { momRule: { contains: 'x'.repeat(201) } } }],
    ['a rule with something else in it', { id: 'abcdefgh', settings: { momRule: { contains: 'MOM', bucket: 'needs' } } }],
    ['a time that is too long', { id: 'abcdefgh', settings: { dailyReviewTime: '20:00:00:00' } }],
    ['a time zone name that is too long', { id: 'abcdefgh', settings: { homeTimeZone: `America/${'x'.repeat(60)}` } }],
    ['a time zone that is not text', { id: 'abcdefgh', settings: { homeTimeZone: -5 } }],
    ['quiet hours with one time', { id: 'abcdefgh', settings: { quietHours: { from: '22:00' } } }],
    ['quiet hours with something more', { id: 'abcdefgh', settings: { quietHours: { from: '22:00', to: '07:00', every: 'day' } } }],
    ['quiet hours as one text', { id: 'abcdefgh', settings: { quietHours: '22:00-07:00' } }],
    ['a quiet hours time that is too long', { id: 'abcdefgh', settings: { quietHours: { from: '22:00:00', to: '07:00' } } }],
    ['bank-not-read hours as text', { id: 'abcdefgh', settings: { bankNotReadAlertHours: '24' } }],
    ['bank-not-read hours that are not whole', { id: 'abcdefgh', settings: { bankNotReadAlertHours: 1.5 } }],
    ['amounts on the lock screen as text', { id: 'abcdefgh', settings: { amountsOnLockScreen: 'on' } }],
    ['a bad decision number', { id: 'short', settings: { payScheduleDays: 7 } }],
    ['a yes that is not true or false', { id: 'abcdefgh', settings: { payScheduleDays: 7 }, confirmed: 'yes' }],
    ['a preview key that is not text', { id: 'abcdefgh', settings: { payScheduleDays: 7 }, seen: 5 }],
    ['a preview key that is not one', { id: 'abcdefgh', settings: { payScheduleDays: 7 }, seen: 'not a key' }],
    ['something more', { id: 'abcdefgh', settings: { payScheduleDays: 7 }, also: 1 }],
  ])('2 refuses %s', (_why, value) => {
    expect(parseSettingsRequest(value)).toBeNull();
    expect(parseRequest(value)).toBeNull();
  });
});

describe('4.2 6.2 7.4 reading what the phone sent: a sorting rule', () => {
  it('4.2 6.2 7.4 takes adding, changing, and removing a rule', () => {
    const add = { id: 'abcdefgh', rule: { add: { for: 'purchase', contains: ' GROCER ', to: 'needs' } } };
    expect(parseRuleRequest(add)).toEqual({ id: 'abcdefgh', rule: { add: { for: 'purchase', contains: 'GROCER', to: 'needs' } } });
    const change = { id: 'abcdefgh', rule: { change: { id: 'grocer', for: 'deposit', contains: 'FRIEND', to: 'momReserve' } } };
    expect(parseRuleRequest(change)).toEqual(change);
    const remove = { id: 'abcdefgh', rule: { remove: 'grocer' }, confirmed: true };
    expect(parseRuleRequest(remove)).toEqual(remove);
    expect(parseRequest(remove)).toEqual(remove);
  });

  it.each([
    ['a purchase rule for savings', { add: { for: 'purchase', contains: 'X', to: 'savings' } }],
    ['a deposit rule that makes a paycheck (B55)', { add: { for: 'deposit', contains: 'X', to: 'paycheck' } }],
    ['a person rule for the mom reserve', { add: { for: 'person', contains: 'X', to: 'momReserve' } }],
    ['a rule for fees', { add: { for: 'fee', contains: 'X', to: 'needs' } }],
    ['a rule with no text', { add: { for: 'purchase', contains: ' ', to: 'needs' } }],
    ['a rule with too much text', { add: { for: 'purchase', contains: 'x'.repeat(201), to: 'needs' } }],
    ['a change with no rule named', { change: { for: 'purchase', contains: 'X', to: 'needs' } }],
    ['a removal of nothing', { remove: '' }],
    ['two things at once', { add: { for: 'purchase', contains: 'X', to: 'needs' }, remove: 'grocer' }],
    ['a split', { add: { for: 'purchase', contains: 'X', split: [{ bucket: 'needs', amount: 1 }] } }],
  ])('4.2 refuses %s', (_why, edit) => {
    expect(parseRuleRequest({ id: 'abcdefgh', rule: edit })).toBeNull();
    expect(parseRequest({ id: 'abcdefgh', rule: edit })).toBeNull();
  });
});

describe('13.1 a change to the split or the mom reserve, from Settings', () => {
  it('13.1 it is what the book does: the setting changes now, and this pay period keeps what it started with', () => {
    const a = setup();
    const b = setup();
    const r = done(a.desk.settings(settings({ split: { savings: 40, needs: 40, wants: 20 } })));
    b.book.changeSettings({ split: { savings: 40, needs: 40, wants: 20 } }, TODAY);
    expect(snapshot(a.book)).toBe(snapshot(b.book));
    expect(a.book.splitInForce().split).toEqual({ savings: 50, needs: 30, wants: 20 });
    expect(r).toEqual({ ok: true, replayed: false, done: { changed: ['split'], fromNextPaycheck: true, rechecked: [] } });
  });

  it('13.1 B38 any other setting applies right away, and says so', () => {
    const { book, desk } = setup();
    const r = done(desk.settings(settings({ payScheduleDays: 7 })));
    expect(r.done).toEqual({ changed: ['payScheduleDays'], fromNextPaycheck: false, rechecked: [] });
    expect(book.settings().payScheduleDays).toBe(7);
  });

  it('13.1 the reserve and its cap together: only the one that changed is changed and logged', () => {
    const { book, desk } = setup();
    const r = done(desk.settings(settings({ momReservePerPaycheck: 150_000, momReserveCap: 200_000 })));
    expect(r.done.changed).toEqual(['momReserveCap']);
    expect(book.changeLog()).toEqual([{ date: TODAY, kind: 'settings-changed', changes: { momReserveCap: 200_000 }, before: { momReserveCap: 300_000 } }]);
  });
});

describe('13.5 every settings change is logged, with the date and what it was', () => {
  it('13.5 each change, with today\'s date, the new value and the old one', () => {
    const { book, desk } = setup();
    done(desk.settings(settings({ oldCardPromoEndDate: '2027-03-31' })));
    done(desk.settings(settings({ lowBucketAlertPercent: 25, dailyReviewTime: '21:00' })));
    expect(book.changeLog()).toEqual([
      { date: TODAY, kind: 'settings-changed', changes: { oldCardPromoEndDate: '2027-03-31' }, before: { oldCardPromoEndDate: null } },
      { date: TODAY, kind: 'settings-changed', changes: { lowBucketAlertPercent: 25, dailyReviewTime: '21:00' }, before: { lowBucketAlertPercent: 20, dailyReviewTime: '20:00' } },
    ]);
  });

  it('13.5 B101 a change to what it already is changes nothing, logs nothing, and says so', () => {
    const { book, desk } = setup();
    const before = snapshot(book);
    const r = refused(desk.settings(settings({ split: { savings: 50, needs: 30, wants: 20 }, momReserveCap: 300_000 })));
    expect(r).toEqual({ ok: false, code: 'refused', why: 'That is already the setting. Nothing was changed.' });
    expect(snapshot(book)).toBe(before);
  });
});

describe('0.2 every setting in section 2 can be changed from Settings', () => {
  const NEW: Partial<Settings> = {
    split: { savings: 0, needs: 60, wants: 40 },
    momReservePerPaycheck: 1,
    momReserveCap: 0,
    momMonthlyTarget: { low: 0, high: 0 },
    lowBucketAlertPercent: 100,
    cardReminderDaysBefore: [],
    dailyReviewTime: '00:00',
    leftoverAtPayday: { needs: 'move-to-savings', wants: 'roll-over' },
    oldCardPromoEndDate: '2026-12-31',
    paycheckRule: { contains: 'MADE UP EMPLOYER' },
    payScheduleDays: 1,
    momRule: null,
    earlyPaycheckDays: 0,
    quietHours: { from: '00:00', to: '00:00' },
    bankNotReadAlertHours: 168,
    amountsOnLockScreen: true,
  };
  it.each(Object.entries(NEW))('0.2 %s', (key, value) => {
    const { book, desk } = setup();
    const patch = { [key]: value } as Partial<Settings>;
    let r = desk.settings(settings(patch));
    // The paycheck rule and the mom rule ask first, with what they would do (A9).
    if (!r.ok && r.code === 'needs-confirmation') r = desk.settings(settings(patch, { confirmed: true, seen: r.preview?.key ?? '' }));
    done(r);
    expect(book.settings()[key as keyof Settings]).toEqual(value);
  });
});

describe('0.2 a setting the money math refuses changes nothing and says why', () => {
  it.each([
    [{ split: { savings: 50, needs: 50, wants: 10 } }, 'Split must add up to 100, not 110. Nothing was changed.'],
    [{ momReserveCap: -1 }, 'Mom reserve cap must be whole cents, zero or more. Nothing was changed.'],
    [{ momMonthlyTarget: { low: 300_000, high: 200_000 } }, 'Mom monthly target low end must not be above the high end. Nothing was changed.'],
    [{ lowBucketAlertPercent: 101 }, 'Low-bucket alert must be a whole percent from 0 to 100. Nothing was changed.'],
    [{ cardReminderDaysBefore: [7, -1] }, 'Card reminder days must be whole days, zero or more. Nothing was changed.'],
    [{ dailyReviewTime: '25:00' }, 'Daily review time must be HH:MM. Nothing was changed.'],
    [{ oldCardPromoEndDate: '2027-02-30' }, 'Old card promo end date must be a real date. Nothing was changed.'],
    [{ payScheduleDays: 0 }, 'Pay schedule must be a whole number of days, at least 1. Nothing was changed.'],
    [{ homeTimeZone: 'Mars/Olympus_Mons' }, 'Home time zone must be the name of a time zone, such as America/New_York. Nothing was changed.'],
    [{ quietHours: { from: '22:00', to: '7:00' } }, 'Quiet hours must be two times, HH:MM. Nothing was changed.'],
    [{ bankNotReadAlertHours: 0 }, 'The bank-not-read alert must be a whole number of hours from 1 to 168. Nothing was changed.'],
  ] satisfies [Partial<Settings>, string][])('0.2 %o', (patch, why) => {
    const { book, desk } = setup();
    const before = snapshot(book);
    expect(refused(desk.settings(settings(patch)))).toEqual({ ok: false, code: 'refused', why });
    expect(snapshot(book)).toBe(before);
  });
});

describe('13.2 A9 the paycheck rule and the mom rule ask first, and show what they would do', () => {
  it('13.2 A9 setting the paycheck rule asks first, with what it would do from the money math, and changes nothing', () => {
    const { book, desk } = firstSync();
    const before = snapshot(book);
    const patch = { paycheckRule: { contains: PAYROLL } };
    const r = refused(desk.settings(settings(patch)));
    expect(r.code).toBe('needs-confirmation');
    expect(r.why).toBe("Setting the paycheck rule sorts what is waiting for good, so it needs your OK first. Nothing was changed.");
    const preview = book.previewSettingsChange(patch, TODAY);
    expect(r.preview).toEqual({ ...preview, key: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(snapshot(book)).toBe(before);
  });

  it('13.2 A9 with his yes and the preview he saw, it does exactly what the preview said', () => {
    const { book, desk } = firstSync();
    const request = settings({ paycheckRule: { contains: PAYROLL } });
    const asked = refused(desk.settings(request));
    const r = done(desk.settings({ ...request, confirmed: true, seen: asked.preview!.key }));
    expect(r.done.rechecked).toEqual(asked.preview!.items);
    expect(book.pots()).toEqual(asked.preview!.potsAfter);
    expect(book.paychecks().map((p) => p.id)).toEqual(['p1']);
  });

  it('13.2 A9 a yes without the preview, or with one that is out of date, asks again with what it would do now', () => {
    const { book, desk } = firstSync();
    const request = settings({ paycheckRule: { contains: PAYROLL } });
    const asked = refused(desk.settings(request));
    expect(refused(desk.settings({ ...request, confirmed: true })).code).toBe('needs-confirmation');
    // Something new arrives between the question and the yes.
    book.receive(paycheck('p2', '2026-10-20', 1_000));
    const before = snapshot(book);
    const again = refused(desk.settings({ ...request, confirmed: true, seen: asked.preview!.key }));
    expect(again.code).toBe('needs-confirmation');
    expect(again.why).toBe('What it would do has changed since you looked. Check it again. Nothing was changed.');
    expect(again.preview!.items.map((i) => i.id)).toEqual(['p1', 'p2']);
    expect(again.preview!.key).not.toBe(asked.preview!.key);
    expect(snapshot(book)).toBe(before);
    // With his yes to what he saw now, it does that: both are paychecks (Oct 20 is 11 days after Oct 9).
    done(desk.settings({ ...request, confirmed: true, seen: again.preview!.key }));
    expect(book.paychecks().map((p) => p.id)).toEqual(again.preview!.items.filter((i) => i.kind === 'paycheck').map((i) => i.id));
    expect(book.paychecks().map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('13.2 A9 a purchase arriving before his yes changes what the buckets would hold after, so it asks again', () => {
    const { book, desk } = firstSync();
    const request = settings({ momRule: { contains: MOM_NAME } });
    const asked = refused(desk.settings(request));
    book.receive(purchase('e1', '2026-10-20', 1_234, 'MADE UP STORE'));
    const again = refused(desk.settings({ ...request, confirmed: true, seen: asked.preview!.key }));
    expect(again.code).toBe('needs-confirmation');
    expect(again.preview!.items).toEqual(asked.preview!.items);
    expect(again.preview!.potsAfter.unsortedOut).toBe(asked.preview!.potsAfter.unsortedOut + 1_234);
    expect(book.settings().momRule).toBeNull();
  });

  it('13.2 A9 8.1 the mom rule asks first too, and clearing either rule does', () => {
    const { book, desk } = firstSync();
    const mom = refused(desk.settings(settings({ momRule: { contains: MOM_NAME } })));
    expect(mom.why).toBe('Setting the mom rule sorts what is waiting for good, so it needs your OK first. Nothing was changed.');
    expect(mom.preview!.items).toMatchObject([{ kind: 'mom', id: 'z1', fromReserve: 20_000, difference: 0 }]);
    const s = setup();
    const clear = refused(s.desk.settings(settings({ paycheckRule: null })));
    expect(clear.code).toBe('needs-confirmation');
    expect(clear.why).toBe('Clearing the paycheck rule needs your OK first: paychecks will wait in review until you set it again. Nothing was changed.');
    expect(clear.preview!.items).toEqual([]);
    expect(book.reviewItems()).toHaveLength(2);
  });

  it('13.2 A9 B73 a partly refunded payment the mom rule matches stays waiting, and the preview and the answer name it', () => {
    const s = setup({ settings: { momRule: null }, pots: { momReserve: 100_000 } });
    s.book.receive(payPerson('z1', '2026-10-10', 4_000, MOM_NAME));
    s.book.receive({ kind: 'refund', id: 'r1', account: 'checking', date: '2026-10-11', amount: 1_000, description: 'ZELLE BACK', refundOf: 'z1' });
    const before = snapshot(s.book);
    const pots = s.book.pots();
    const request = settings({ momRule: { contains: MOM_NAME } });
    const asked = refused(s.desk.settings(request));
    const still = { kind: 'still-waiting', id: 'z1', date: '2026-10-10', amount: 3_000, description: `ZELLE TO ${MOM_NAME}`, why: 'partly-refunded' };
    expect(asked.preview!.items).toEqual([still]);
    expect(snapshot(s.book)).toBe(before);
    const r = done(s.desk.settings({ ...request, confirmed: true, seen: asked.preview!.key }));
    expect(r.done.rechecked).toEqual([still]);
    expect(s.book.pots()).toEqual(pots);
    expect(s.book.reviewItems().map((i) => [i.id, i.amount])).toEqual([['z1', 3_000]]);
  });

  it('13.2 A9 a paycheck rule the money math refuses is refused before it asks', () => {
    const { desk } = firstSync();
    expect(refused(desk.settings(settings({ paycheckRule: { contains: PAYROLL }, earlyPaycheckDays: -1 })))).toMatchObject({ code: 'refused', why: 'Early paycheck days must be a whole number, zero or more. Nothing was changed.' });
  });
});

describe('B92 a settings change sent twice changes nothing the second time', () => {
  it('B92 the same decision again gets the first answer back, and nothing changes twice', () => {
    const { book, desk } = setup();
    const request = settings({ momReserveCap: 200_000 });
    const first = done(desk.settings(request));
    const after = snapshot(book);
    expect(desk.settings(request)).toEqual({ ...first, replayed: true });
    expect(snapshot(book)).toBe(after);
    expect(book.changeLog()).toHaveLength(1);
  });

  it('B92 the same decision number for something else is refused', () => {
    const { book, desk } = setup();
    const request = settings({ momReserveCap: 200_000 });
    done(desk.settings(request));
    expect(refused(desk.settings({ ...request, settings: { momReserveCap: 100_000 } })).code).toBe('id-reused');
    expect(refused(desk.rule({ id: request.id, rule: { remove: 'nope' }, confirmed: true })).code).toBe('id-reused');
    expect(desk.move({ id: request.id, move: { from: 'wants', to: 'needs', amount: 1 } })).toMatchObject({ ok: false, code: 'id-reused' });
    expect(book.settings().momReserveCap).toBe(200_000);
  });

  it('B92 a decision number used for a move, or a choice, is not taken for a setting', () => {
    const { book, desk } = setup();
    book.receive(purchase('e1', '2026-10-19', 1_000));
    done(desk.move({ id: 'shared-move-1', move: { from: 'wants', to: 'needs', amount: 1 } }) as never);
    expect(desk.decide({ id: 'shared-pick-1', item: 'e1', choice: { to: 'needs' } })).toMatchObject({ ok: true });
    expect(refused(desk.settings({ id: 'shared-move-1', settings: { payScheduleDays: 7 } })).code).toBe('id-reused');
    expect(refused(desk.rule({ id: 'shared-pick-1', rule: { add: { for: 'purchase', contains: 'X', to: 'needs' } } })).code).toBe('id-reused');
    expect(book.settings().payScheduleDays).toBe(14);
  });

  it('B92 a change that asked first is not remembered: his yes can use the same number', () => {
    const { desk } = firstSync();
    const request = settings({ paycheckRule: { contains: PAYROLL } });
    const asked = refused(desk.settings(request));
    const yes = { ...request, confirmed: true, seen: asked.preview!.key };
    const first = done(desk.settings(yes));
    expect(desk.settings(yes)).toEqual({ ...first, replayed: true });
  });

  it('B92 a refused change is not remembered: fixed, the same number goes through', () => {
    const { book, desk } = setup();
    const request = settings({ split: { savings: 50, needs: 50, wants: 10 } });
    refused(desk.settings(request));
    done(desk.settings({ ...request, settings: { split: { savings: 50, needs: 40, wants: 10 } } }));
    expect(book.settings().split).toEqual({ savings: 50, needs: 40, wants: 10 });
  });
});

describe('13.2 sorting rules from Settings: add, change, remove', () => {
  it('13.2 adding a rule is what the book does: it goes to the end, and sorts what is waiting that it is the first match for', () => {
    const a = setup({ rules: [{ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' }] });
    a.book.receive(purchase('e1', '2026-10-19', 1_000, 'MADE UP CAFE'));
    a.book.receive(purchase('e2', '2026-10-19', 2_000, 'MADE UP CAFE'));
    const request = rule({ add: { for: 'purchase', contains: 'CAFE', to: 'wants' } });
    const r = done(a.desk.rule(request));
    expect(r.done).toEqual({ action: 'added', rule: { id: `rule-${request.id}`, for: 'purchase', contains: 'CAFE', to: 'wants' }, alsoSorted: 2, stillWaiting: [] });
    expect(a.book.rules().map((x) => x.id)).toEqual(['grocer', `rule-${request.id}`]);
    expect(a.book.reviewItems()).toEqual([]);
    expect(a.book.changeLog()).toEqual([{ date: TODAY, kind: 'rule-added', rule: { id: `rule-${request.id}`, for: 'purchase', contains: 'CAFE', bucket: 'wants' } }]);
  });

  it('6.2 7.4 a rule for money in and one for a person', () => {
    const { book, desk } = setup();
    book.receive(deposit('d1', '2026-10-19', 2_500, 'MADE UP FRIEND'));
    book.receive(payPerson('z1', '2026-10-19', 9_000, 'MADE UP LANDLORD'));
    done(desk.rule(rule({ add: { for: 'deposit', contains: 'FRIEND', to: 'momReserve' } })));
    done(desk.rule(rule({ add: { for: 'person', contains: 'LANDLORD', to: 'not-mine' } })));
    expect(book.pots()).toMatchObject({ momReserve: 152_500, heldForOthers: -9_000, unsortedIn: 0, unsortedOut: 0 });
  });

  it('13.2 A19 a rule that matches something it cannot sort leaves it waiting, and names it', () => {
    const { book, desk } = setup();
    book.receive(payPerson('z1', '2026-10-15', 9_000, 'MADE UP FRIEND'));
    book.receive({ kind: 'refund', id: 'r1', account: 'checking', date: '2026-10-16', amount: 1_000, description: 'ZELLE BACK', refundOf: 'z1' });
    const r = done(desk.rule(rule({ add: { for: 'person', contains: 'FRIEND', to: 'mom' } })));
    expect(r.done.stillWaiting).toEqual([{ item: 'z1', name: 'ZELLE TO MADE UP FRIEND' }]);
    expect(r.done.alsoSorted).toBe(0);
  });

  it('13.2 changing a rule is what the book does, and logs what it was', () => {
    const { book, desk } = setup({ rules: [{ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' }] });
    const r = done(desk.rule(rule({ change: { id: 'grocer', for: 'purchase', contains: 'GROCERY', to: 'wants' } })));
    expect(r.done).toEqual({ action: 'changed', rule: { id: 'grocer', for: 'purchase', contains: 'GROCERY', to: 'wants' }, alsoSorted: 0, stillWaiting: [] });
    expect(book.rules()).toEqual([{ id: 'grocer', for: 'purchase', contains: 'GROCERY', bucket: 'wants' }]);
    expect(book.changeLog()).toMatchObject([{ kind: 'rule-changed', before: { contains: 'GROCER', bucket: 'needs' }, after: { contains: 'GROCERY', bucket: 'wants' } }]);
  });

  it('13.2 a rule can change kind and keeps its place', () => {
    const { book, desk } = setup({ rules: [{ id: 'a', for: 'purchase', contains: 'A', bucket: 'needs' }, { id: 'b', for: 'purchase', contains: 'B', bucket: 'needs' }] });
    done(desk.rule(rule({ change: { id: 'a', for: 'person', contains: 'A', to: 'mom' } })));
    expect(book.rules()).toEqual([{ id: 'a', for: 'person', contains: 'A', choice: { to: 'mom' } }, { id: 'b', for: 'purchase', contains: 'B', bucket: 'needs' }]);
  });

  it('13.2 B101 changing a rule to what it already says changes nothing and says so', () => {
    const { book, desk } = setup({ rules: [{ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' }] });
    expect(refused(desk.rule(rule({ change: { id: 'grocer', for: 'purchase', contains: 'GROCER', to: 'needs' } })))).toEqual({ ok: false, code: 'refused', why: 'The rule already says that. Nothing was changed.' });
    expect(book.changeLog()).toEqual([]);
  });

  it('13.2 removing a rule asks first, and with his yes it goes; what it sorted stays where it is', () => {
    const { book, desk } = setup({ rules: [{ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' }] });
    book.receive(purchase('e1', '2026-10-19', 1_000, 'MADE UP GROCER'));
    const request = rule({ remove: 'grocer' });
    const before = snapshot(book);
    const asked = refused(desk.rule(request));
    expect(asked).toEqual({ ok: false, code: 'needs-confirmation', why: 'Removing the rule "GROCER" needs your OK first. What it already sorted stays where it is. Nothing was changed.' });
    expect(snapshot(book)).toBe(before);
    const r = done(desk.rule({ ...request, confirmed: true }));
    expect(r.done).toEqual({ action: 'removed', rule: { id: 'grocer', for: 'purchase', contains: 'GROCER', to: 'needs' }, alsoSorted: 0, stillWaiting: [] });
    expect(book.rules()).toEqual([]);
    expect(book.purchases()[0]?.sortedTo).toEqual({ to: 'needs' });
  });

  it('13.2 a rule that is not there any more cannot be changed or removed', () => {
    const { book, desk } = setup();
    expect(refused(desk.rule(rule({ change: { id: 'gone', for: 'purchase', contains: 'X', to: 'needs' } })))).toEqual({ ok: false, code: 'not-waiting', why: 'That rule is not there any more. Nothing was changed.' });
    expect(refused(desk.rule(rule({ remove: 'gone' }, { confirmed: true })))).toEqual({ ok: false, code: 'not-waiting', why: 'That rule is not there any more. Nothing was changed.' });
    expect(book.changeLog()).toEqual([]);
  });

  it('B92 a rule added twice by the same decision is added once', () => {
    const { book, desk } = setup();
    const request = rule({ add: { for: 'purchase', contains: 'CAFE', to: 'wants' } });
    const first = done(desk.rule(request));
    expect(desk.rule(request)).toEqual({ ...first, replayed: true });
    expect(book.rules()).toHaveLength(1);
    // A second tap is a second decision: a second rule, as he asked.
    done(desk.rule(rule({ add: { for: 'purchase', contains: 'CAFE', to: 'wants' } })));
    expect(book.rules()).toHaveLength(2);
  });

  it('0.1 A19 an item the new rule would sort into a total too large to stay exact stays waiting, named', () => {
    const { book, desk } = setup({ pots: { wants: Number.MAX_SAFE_INTEGER - 10 } });
    book.receive(deposit('d1', '2026-10-19', 1_000, 'MADE UP FRIEND'));
    const pots = book.pots();
    const r = done(desk.rule(rule({ add: { for: 'deposit', contains: 'FRIEND', to: 'wants' } })));
    expect(r.done).toMatchObject({ alsoSorted: 0, stillWaiting: [{ item: 'd1', name: 'MADE UP FRIEND' }] });
    expect(book.pots()).toEqual(pots);
    expect(book.reviewItems().map((i) => i.id)).toEqual(['d1']);
  });
});

describe('13.2 A22 moving a rule up or down, from Settings', () => {
  const RULES = [
    { id: 'store', for: 'purchase', contains: 'STORE', bucket: 'needs' },
    { id: 'friend', for: 'deposit', contains: 'FRIEND', choice: { to: 'wants' } },
    { id: 'big', for: 'purchase', contains: 'BIG STORE', bucket: 'wants' },
  ] as const;

  it('A22 reads a move: a rule and up or down, nothing else', () => {
    const move = { id: 'abcdefgh', rule: { move: { id: 'big', direction: 'up' } } };
    expect(parseRuleRequest(move)).toEqual(move);
    expect(parseRequest(move)).toEqual(move);
    for (const bad of [{ id: 'big', direction: 'left' }, { id: '', direction: 'up' }, { id: 'big' }, { id: 'big', direction: 'up', by: 2 }, 'big']) {
      expect(parseRuleRequest({ id: 'abcdefgh', rule: { move: bad } }), JSON.stringify(bad)).toBeNull();
    }
  });

  it('A22 13.5 a move is what the book does, logged, and the answer says which way it went', () => {
    const a = setup({ rules: [...RULES] });
    const b = setup({ rules: [...RULES] });
    const r = done(a.desk.rule(rule({ move: { id: 'big', direction: 'up' } })));
    b.book.moveRule('big', 'up', TODAY);
    expect(snapshot(a.book)).toBe(snapshot(b.book));
    expect(r.done).toEqual({ action: 'moved-up', rule: { id: 'big', for: 'purchase', contains: 'BIG STORE', to: 'wants' }, alsoSorted: 0, stillWaiting: [] });
    expect(a.book.rules().map((x) => x.id)).toEqual(['big', 'friend', 'store']);
    expect(done(a.desk.rule(rule({ move: { id: 'big', direction: 'down' } }))).done.action).toBe('moved-down');
  });

  it('A22 the first cannot move up and the last cannot move down: refused in words, nothing changes', () => {
    const { book, desk } = setup({ rules: [...RULES] });
    const before = snapshot(book);
    expect(refused(desk.rule(rule({ move: { id: 'store', direction: 'up' } })))).toEqual({ ok: false, code: 'refused', why: 'It is already the first rule of its kind. Nothing was changed.' });
    expect(refused(desk.rule(rule({ move: { id: 'big', direction: 'down' } })))).toEqual({ ok: false, code: 'refused', why: 'It is already the last rule of its kind. Nothing was changed.' });
    expect(refused(desk.rule(rule({ move: { id: 'friend', direction: 'down' } })))).toMatchObject({ code: 'refused' });
    expect(refused(desk.rule(rule({ move: { id: 'gone', direction: 'up' } })))).toEqual({ ok: false, code: 'not-waiting', why: 'That rule is not there any more. Nothing was changed.' });
    expect(snapshot(book)).toBe(before);
  });

  it('A22 13.2 A19 the moved rule sorts what waits that it is now the first match for, and names what it cannot sort', () => {
    const { book, desk } = setup({ settings: { momRule: null }, pots: { needs: 50_000, momReserve: 100_000 } });
    book.receive(payPerson('z1', '2026-10-15', 4_000, 'MADE UP FRIEND'));
    book.receive({ kind: 'refund', id: 'r1', account: 'checking', date: '2026-10-16', amount: 1_000, description: 'ZELLE BACK', refundOf: 'z1' });
    // Two rules for mom; neither can sort a payment partly refunded (B73), so it waits.
    book.addRule({ id: 'first', for: 'person', contains: 'MADE UP FRIEND', choice: { to: 'mom' } }, TODAY);
    book.addRule({ id: 'second', for: 'person', contains: 'FRIEND', choice: { to: 'mom' } }, TODAY);
    const r = done(desk.rule(rule({ move: { id: 'second', direction: 'up' } })));
    expect(r.done).toMatchObject({ action: 'moved-up', alsoSorted: 0, stillWaiting: [{ item: 'z1', name: 'ZELLE TO MADE UP FRIEND' }] });
    // One that can sort it, moved to the top, does.
    book.addRule({ id: 'needs', for: 'person', contains: 'FRIEND', choice: { to: 'needs' } }, TODAY);
    done(desk.rule(rule({ move: { id: 'needs', direction: 'up' } })));
    const top = done(desk.rule(rule({ move: { id: 'needs', direction: 'up' } })));
    expect(top.done).toMatchObject({ alsoSorted: 1, stillWaiting: [] });
    expect(book.reviewItems()).toEqual([]);
    expect(book.pots().needs).toBe(50_000 - 3_000);
  });

  it('B92 a move sent twice moves once', () => {
    const { book, desk } = setup({ rules: [...RULES] });
    const request = rule({ move: { id: 'big', direction: 'up' } });
    const first = done(desk.rule(request));
    expect(desk.rule(request)).toEqual({ ...first, replayed: true });
    expect(book.rules().map((x) => x.id)).toEqual(['big', 'friend', 'store']);
    expect(book.changeLog()).toHaveLength(1);
  });
});
