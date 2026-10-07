import { readFileSync } from 'node:fs';
import type { Fetch } from '../src/plaid/client.js';

// Plays back saved Plaid responses (test/fixtures), one stage at a time. In
// each stage, /transactions/sync answers by cursor, and /accounts/get and
// /liabilities/get with that stage's answer. The keys are made up.
export interface Recording {
  readonly about: string;
  readonly stages: readonly {
    readonly name: string;
    readonly sync: Readonly<Record<string, unknown>>;
    readonly accounts: unknown;
    readonly liabilities: unknown;
  }[];
}

export const REPLAY_KEYS = {
  clientId: 'client-made-up-123',
  secret: 'secret-made-up-456',
  accessToken: 'access-sandbox-99999999-8888-4777-8666-555555555555',
  publicToken: 'public-sandbox-99999999-8888-4777-8666-444444444444',
} as const;

export function loadRecording(name: string): Recording {
  return JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as Recording;
}

export class Replay {
  stage = 0;
  readonly #recording: Recording;
  readonly #itemId: string;

  constructor(recording: Recording, itemId: string) {
    this.#recording = recording;
    this.#itemId = itemId;
  }

  readonly fetch: Fetch = async (url, init) => {
    const endpoint = url.replace('https://sandbox.plaid.com', '');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const reply = (status: number, value: unknown): { ok: boolean; status: number; text: () => Promise<string> } => ({
      ok: status === 200,
      status,
      text: async () => JSON.stringify(value),
    });
    if (init.headers['PLAID-CLIENT-ID'] !== REPLAY_KEYS.clientId || init.headers['PLAID-SECRET'] !== REPLAY_KEYS.secret) {
      return reply(400, { error_type: 'INVALID_INPUT', error_code: 'INVALID_API_KEYS', request_id: 'req-replay' });
    }
    if (endpoint === '/sandbox/public_token/create') return reply(200, { public_token: REPLAY_KEYS.publicToken, request_id: 'req-replay' });
    if (endpoint === '/item/public_token/exchange') return reply(200, { access_token: REPLAY_KEYS.accessToken, item_id: this.#itemId, request_id: 'req-replay' });
    if (body['access_token'] !== REPLAY_KEYS.accessToken) return reply(400, { error_type: 'INVALID_INPUT', error_code: 'INVALID_ACCESS_TOKEN', request_id: 'req-replay' });
    const stage = this.#recording.stages[this.stage];
    if (stage === undefined) throw new Error(`no stage ${this.stage} in the recording`);
    if (endpoint === '/accounts/get') return reply(200, stage.accounts);
    if (endpoint === '/liabilities/get') return reply(200, stage.liabilities);
    if (endpoint === '/transactions/sync') {
      const cursor = typeof body['cursor'] === 'string' ? body['cursor'] : 'null';
      const page = stage.sync[cursor];
      if (page === undefined) return reply(400, { error_type: 'INVALID_INPUT', error_code: 'INVALID_CURSOR', request_id: 'req-replay' });
      return reply(200, page);
    }
    return reply(400, { error_type: 'INVALID_REQUEST', error_code: 'UNKNOWN_FIELDS', request_id: 'req-replay' });
  };
}
