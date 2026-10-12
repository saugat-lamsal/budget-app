import Database from 'better-sqlite3';

// The server's database: one SQLite file. It holds the bank connection (with
// its key encrypted), what the bank sent, the book's history (what the bank
// sent the book and every answer of his, in order), and the card statements.
// Every sync writes all of its changes in one transaction, with the bookmark
// for the next sync, and every answer is saved in one transaction with its
// decision number, so each is all or nothing.
export type Db = Database.Database;

// A query made over and over (the alert timer looks every minute), prepared
// once per database and used again. A statement prepared afresh each time
// holds native memory until it is collected, which can be long after: a
// simulated half year of minutes grew the process to 2 GB.
const PREPARED = new WeakMap<Db, Map<string, Database.Statement>>();

export function statement(db: Db, sql: string): Database.Statement {
  let bySql = PREPARED.get(db);
  if (bySql === undefined) {
    bySql = new Map();
    PREPARED.set(db, bySql);
  }
  let prepared = bySql.get(sql);
  if (prepared === undefined) {
    prepared = db.prepare(sql);
    bySql.set(sql, prepared);
  }
  return prepared;
}

// Each step brings the database from the version before it to the next. A
// step is never changed once released; changes get a new step.
const STEPS: readonly string[] = [
  `
  -- The one bank connection (rulebook section 1).
  CREATE TABLE connection (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    item_id TEXT NOT NULL,
    institution_id TEXT,
    -- The access token, encrypted. Never stored in the clear.
    sealed_key TEXT NOT NULL,
    -- Where the next sync starts; null before the first one.
    cursor TEXT,
    -- Plaid has sent all the history it is going to (HISTORICAL_UPDATE_COMPLETE).
    history_complete INTEGER NOT NULL DEFAULT 0 CHECK (history_complete IN (0, 1)),
    -- 10.5: the bank wants him to log in again.
    needs_login INTEGER NOT NULL DEFAULT 0 CHECK (needs_login IN (0, 1)),
    connected_on TEXT NOT NULL
  );

  -- His accounts as Plaid shows them, and which of the four each one is.
  CREATE TABLE accounts (
    plaid_account_id TEXT PRIMARY KEY,
    role TEXT UNIQUE CHECK (role IN ('checking', 'savings', 'everyday-card', 'old-card')),
    raw TEXT NOT NULL,
    updated_by_sync INTEGER NOT NULL
  );

  -- Everything Plaid sent, in its latest version, and what the app did with it.
  CREATE TABLE bank_items (
    transaction_id TEXT PRIMARY KEY,
    plaid_account_id TEXT NOT NULL,
    raw TEXT NOT NULL,
    pending INTEGER NOT NULL CHECK (pending IN (0, 1)),
    -- Plaid's sign: positive is money out. Null when it could not be read.
    amount_cents INTEGER,
    removed INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0, 1)),
    -- history: before setup day, already in the starting balances.
    -- sent: in the book. waiting: pending, goes to the book once it posts.
    -- held: needs a decision first. skipped: no money moved, or not one of his accounts.
    status TEXT NOT NULL CHECK (status IN ('history', 'sent', 'waiting', 'held', 'skipped')),
    -- What the app read it as: purchase, deposit, transfer-sent, ...
    kind TEXT,
    -- Its id in the book, when sent.
    book_id TEXT,
    -- The posted transaction that replaced this pending one (4.6).
    replaced_by TEXT,
    first_sync INTEGER NOT NULL,
    last_sync INTEGER NOT NULL
  );

  -- What the book was given, in order. The book is rebuilt from it.
  CREATE TABLE book_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    sync INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('setup', 'receive')),
    payload TEXT NOT NULL
  );

  -- The latest statement details for each card account (section 9), kept
  -- whether or not the account is set as one of his cards yet.
  CREATE TABLE statements (
    plaid_account_id TEXT PRIMARY KEY,
    raw TEXT NOT NULL,
    updated_by_sync INTEGER NOT NULL
  );

  -- Bank changes the app did not apply, waiting for him to decide.
  CREATE TABLE attention (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync INTEGER NOT NULL,
    transaction_id TEXT,
    what TEXT NOT NULL
  );

  CREATE TABLE syncs (
    id INTEGER PRIMARY KEY,
    today TEXT NOT NULL,
    cursor_before TEXT,
    cursor_after TEXT,
    added INTEGER NOT NULL,
    modified INTEGER NOT NULL,
    removed INTEGER NOT NULL,
    sent INTEGER NOT NULL,
    held INTEGER NOT NULL
  );

  -- Settings of the bank connection (rule 0.2), such as the bank rules.
  CREATE TABLE settings (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- 13.5: every change, with its date.
  CREATE TABLE change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    what TEXT NOT NULL,
    detail TEXT NOT NULL
  );
  `,
  `
  -- Step 2 (the real server keeps everything): his answers join the book's
  -- history, next to what the bank sent, in the order they happened. Each
  -- event keeps the day it was made on, and the totals the book had after it,
  -- so a replay can be checked. Events saved before this step get their
  -- totals the first time they replay.
  CREATE TABLE book_events_2 (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    -- The sync that brought it, for what the bank sent.
    sync INTEGER,
    kind TEXT NOT NULL CHECK (kind IN ('setup', 'receive', 'answer')),
    date TEXT NOT NULL,
    payload TEXT NOT NULL,
    totals TEXT
  );
  INSERT INTO book_events_2 (seq, sync, kind, date, payload, totals)
    SELECT seq, sync, kind,
      CASE kind WHEN 'setup' THEN json_extract(payload, '$.date') ELSE (SELECT today FROM syncs WHERE syncs.id = book_events.sync) END,
      payload, NULL
    FROM book_events;
  DROP TABLE book_events;
  ALTER TABLE book_events_2 RENAME TO book_events;

  -- Each decision number made on the phone, with the request it came with
  -- and the first answer it got, saved in the same step as the event it
  -- made. A repeat gets that answer again and changes nothing.
  CREATE TABLE decisions (
    id TEXT PRIMARY KEY,
    desk TEXT NOT NULL CHECK (desk IN ('choice', 'move', 'settings', 'rule', 'setup', 'bank-rule')),
    fingerprint TEXT NOT NULL,
    answer TEXT NOT NULL,
    seq INTEGER NOT NULL REFERENCES book_events (seq)
  );

  -- 0.5: the last safe to spend the bank backed up, and when (B82).
  CREATE TABLE last_checked (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    amount INTEGER NOT NULL,
    at TEXT NOT NULL
  );
  `,
  `
  -- Step 3 (passkey login): his passkeys, by the public key only. The
  -- private key never leaves his device.
  CREATE TABLE passkeys (
    id TEXT PRIMARY KEY,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL,
    transports TEXT NOT NULL,
    device TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Each device logged in, by a hash of its login: the login itself is only
  -- in that device's cookie.
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    device TEXT NOT NULL,
    passkey_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- One-time codes for making a passkey, by a hash. Good once, until expires_at.
  CREATE TABLE login_codes (
    code_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  `,
  `
  -- Step 4 (syncing on a timer): each time a sync read the bank, whether or
  -- not it brought anything new. Home's "Checked at" is the last one, and the
  -- next sync is due one interval after it. A sync that failed adds nothing.
  CREATE TABLE bank_reads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- The moment the bank was read, as an instant (ISO, UTC).
    at TEXT NOT NULL,
    -- Whether it brought anything new (and so saved it).
    changed INTEGER NOT NULL CHECK (changed IN (0, 1))
  );
  `,
  `
  -- Step 5 (Phase 5, alerts): the alerts the server worked out join the
  -- book's history, as "alerts" events, so a restart knows every alert that
  -- went out. The table is made again to let it take them (SQLite cannot
  -- change a CHECK); every event keeps its number, so the decision numbers
  -- still name theirs.
  CREATE TABLE book_events_5 (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    -- The sync that brought it, for what the bank sent.
    sync INTEGER,
    kind TEXT NOT NULL CHECK (kind IN ('setup', 'receive', 'answer', 'alerts')),
    date TEXT NOT NULL,
    payload TEXT NOT NULL,
    totals TEXT
  );
  INSERT INTO book_events_5 (seq, sync, kind, date, payload, totals) SELECT seq, sync, kind, date, payload, totals FROM book_events;
  DROP TABLE book_events;
  ALTER TABLE book_events_5 RENAME TO book_events;

  -- The outbox: every alert worked out, with when it came due and when it was
  -- sent, written in the same step as the event that gave it. Instants are
  -- ISO, UTC.
  CREATE TABLE outbox (
    key TEXT PRIMARY KEY,
    seq INTEGER NOT NULL REFERENCES book_events (seq),
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    due_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    -- When the sender said it was handed over; NULL until then.
    sent_at TEXT,
    tries INTEGER NOT NULL CHECK (tries >= 0),
    last_try_at TEXT,
    next_try_at TEXT NOT NULL,
    last_error TEXT
  );
  -- What is not sent yet, by when it is to be tried: the alert timer looks every minute.
  CREATE INDEX outbox_unsent ON outbox (next_try_at) WHERE sent_at IS NULL;
  `,
  `
  -- 10.10 (QUESTIONS.md A39): what each alert is about (its facts, as JSON),
  -- so the words sent to the lock screen can leave its amounts out, as the
  -- setting says when it is sent. NULL for an alert kept before this step:
  -- it is sent with the words it was kept with.
  ALTER TABLE outbox ADD COLUMN facts TEXT;
  `,
  `
  -- Step 7 (Phase 5, the phone): each device's push subscription, made when
  -- he turns notifications on there, and tied to that device's login: logging
  -- out there takes it away with the login. The endpoint is the address at
  -- the device's push service; p256dh and auth are the device's public key
  -- and secret, which each alert is encrypted for. Instants are ISO, UTC.
  CREATE TABLE push_subscriptions (
    session_hash TEXT PRIMARY KEY REFERENCES sessions (token_hash) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    device TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- A device whose push service said its subscription is gone (it was
  -- removed): when, and why, so that device's Notifications card can say so.
  CREATE TABLE push_stopped (
    session_hash TEXT PRIMARY KEY REFERENCES sessions (token_hash) ON DELETE CASCADE,
    at TEXT NOT NULL,
    device TEXT NOT NULL,
    why TEXT NOT NULL
  );
  `,
];

// Steps that make a table again, which SQLite does with foreign keys off
// (they cannot be turned off inside the step's transaction); every foreign key
// is checked before the step is kept.
const REMAKES_TABLES = new Set([4]);

export const SCHEMA_VERSION = STEPS.length;

// path is a file, or ':memory:' for a database that lives only in this process.
// upTo, for tests only: the version to stop at, to make a database as an
// older version of the app left it.
export function openDatabase(path: string, options: { readonly upTo?: number } = {}): Db {
  const db = new Database(path);
  try {
    if (path !== ':memory:') db.pragma('journal_mode = WAL');
    // Every commit reaches the disk before it counts as done.
    db.pragma('synchronous = FULL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    migrate(db, options.upTo ?? SCHEMA_VERSION);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

function migrate(db: Db, upTo: number): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > SCHEMA_VERSION) {
    throw new Error(`the database is from a newer version of the app (schema ${version}, this app knows ${SCHEMA_VERSION})`);
  }
  for (let step = version; step < upTo; step += 1) {
    const remakes = REMAKES_TABLES.has(step);
    if (remakes) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(STEPS[step] ?? '');
        if (remakes && (db.pragma('foreign_key_check') as unknown[]).length > 0) throw new Error(`step ${step + 1} of the database would break a foreign key`);
        db.pragma(`user_version = ${step + 1}`);
      })();
    } finally {
      if (remakes) db.pragma('foreign_keys = ON');
    }
  }
}
