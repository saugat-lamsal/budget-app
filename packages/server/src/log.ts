// What the server writes down as it works. Nothing secret may get into a log
// line (CLAUDE.md safety rules): bank keys of any Plaid environment are found
// by their form and hidden, and so is any other secret the log is told
// about, such as the Plaid API keys. Requests to Plaid are never logged with
// what was sent.
export interface LogLine {
  readonly level: 'info' | 'warn' | 'error';
  readonly event: string;
  readonly fields?: Readonly<Record<string, unknown>>;
}

export interface Log {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

const BANK_KEY = /\b(?:access|public)-(?:sandbox|development|production)-[A-Za-z0-9-]+/g;
// Shorter values would hide ordinary words.
const SHORTEST_SECRET = 8;

export function hideSecrets(text: string, secrets: readonly string[]): string {
  let shown = text.replace(BANK_KEY, '[hidden]');
  for (const secret of secrets) {
    if (secret.trim().length >= SHORTEST_SECRET) shown = shown.split(secret).join('[hidden]');
  }
  return shown;
}

function hideIn(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return hideSecrets(value, secrets);
  if (value instanceof Error) return hideSecrets(value.stack ?? `${value.name}: ${value.message}`, secrets);
  if (Array.isArray(value)) return value.map((item) => hideIn(item, secrets));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, hideIn(inner, secrets)]));
  }
  return value;
}

function makeLog(write: (line: LogLine) => void, secrets: readonly string[]): Log {
  const put = (level: LogLine['level'], event: string, fields?: Record<string, unknown>): void => {
    const line: LogLine = { level, event: hideSecrets(event, secrets) };
    write(fields === undefined ? line : { ...line, fields: hideIn(fields, secrets) as Record<string, unknown> });
  };
  return {
    info: (event, fields) => put('info', event, fields),
    warn: (event, fields) => put('warn', event, fields),
    error: (event, fields) => put('error', event, fields),
  };
}

// Keeps the lines in a list: for tests, and for the sync report.
export function memoryLog(lines: LogLine[], secrets: readonly string[] = []): Log {
  return makeLog((line) => lines.push(line), secrets);
}

// One JSON line per entry on standard output.
export function consoleLog(secrets: readonly string[] = []): Log {
  return makeLog((line) => process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), ...line })}\n`), secrets);
}
