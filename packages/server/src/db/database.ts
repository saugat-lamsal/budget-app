import Database from 'better-sqlite3';

// The server's database: one SQLite file. It holds the bank connection (with
// its key encrypted), what the bank sent, the book's history, and the card
// statements. Every sync writes all of its changes in one transaction, with
// the bookmark for the next sync, so a sync is all or nothing.
export type Db = Database.Database;

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

  -- The latest statement details for each card (section 9).
  CREATE TABLE statements (
    role TEXT PRIMARY KEY CHECK (role IN ('everyday-card', 'old-card')),
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
];

export const SCHEMA_VERSION = STEPS.length;

// path is a file, or ':memory:' for a database that lives only in this process.
export function openDatabase(path: string): Db {
  const db = new Database(path);
  try {
    if (path !== ':memory:') db.pragma('journal_mode = WAL');
    // Every commit reaches the disk before it counts as done.
    db.pragma('synchronous = FULL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

function migrate(db: Db): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > SCHEMA_VERSION) {
    throw new Error(`the database is from a newer version of the app (schema ${version}, this app knows ${SCHEMA_VERSION})`);
  }
  for (let step = version; step < SCHEMA_VERSION; step += 1) {
    db.transaction(() => {
      db.exec(STEPS[step] ?? '');
      db.pragma(`user_version = ${step + 1}`);
    })();
  }
}
