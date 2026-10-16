import { createHash } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { KeyAnswer, KeySource, WebhookKey } from '../src/plaid/webhook.js';

// A made-up Plaid that signs webhooks the way Plaid does (QUESTIONS.md A47):
// an ES256 JWT in the Plaid-Verification header, with the key's id (kid) in
// its header and, in its body, when it was made (iat, in seconds) and the
// SHA-256 of the exact bytes of the request body. Its public key is handed
// out by kid, as /webhook_verification_key/get does. The key pair is made for
// each test and never leaves it. Every name and number is made up.

// A private key as jose makes it.
type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

export interface Signed {
  readonly header: string;
  readonly body: Buffer;
}

export class FakeWebhookSigner {
  readonly kid: string;
  // The public half, as Plaid hands it out.
  key: WebhookKey;
  readonly #privateKey: PrivateKey;

  private constructor(kid: string, key: WebhookKey, privateKey: PrivateKey) {
    this.kid = kid;
    this.key = key;
    this.#privateKey = privateKey;
  }

  static async make(kid = 'made-up-key-1', createdAt = 1_780_000_000): Promise<FakeWebhookSigner> {
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
    const jwk = await exportJWK(publicKey);
    if (jwk.x === undefined || jwk.y === undefined) throw new Error('no public key');
    return new FakeWebhookSigner(kid, { alg: 'ES256', crv: 'P-256', kty: 'EC', use: 'sig', kid, x: jwk.x, y: jwk.y, created_at: createdAt, expired_at: null }, privateKey);
  }

  // Signs a body at `at`. Options make it wrong in one way: another kid,
  // another body's hash, another time it was made (null: none; a string: in
  // words), or other claims.
  async sign(body: string | Buffer, at: Date, wrong: { readonly kid?: string; readonly hashOf?: string | Buffer; readonly iat?: number | string | null; readonly claims?: Record<string, unknown> } = {}): Promise<Signed> {
    const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    const hash = createHash('sha256').update(wrong.hashOf ?? bytes).digest('hex');
    const iat = wrong.iat === undefined ? Math.floor(at.getTime() / 1000) : wrong.iat;
    const jwt = new SignJWT({ request_body_sha256: hash, ...(typeof iat === 'string' ? { iat } : {}), ...wrong.claims } as Record<string, unknown>).setProtectedHeader({ alg: 'ES256', kid: wrong.kid ?? this.kid, typ: 'JWT' });
    const header = await (typeof iat === 'number' ? jwt.setIssuedAt(iat) : jwt).sign(this.#privateKey);
    return { header, body: bytes };
  }
}

// What Plaid's /webhook_verification_key/get answers, with how often it was asked.
export class FakeKeySource implements KeySource {
  readonly keys = new Map<string, WebhookKey>();
  asked: string[] = [];
  // While set, asking fails with this, as Plaid unreachable would.
  failing: string | null = null;

  add(...signers: readonly FakeWebhookSigner[]): this {
    for (const s of signers) this.keys.set(s.kid, s.key);
    return this;
  }

  async fetch(kid: string): Promise<KeyAnswer> {
    this.asked.push(kid);
    await Promise.resolve();
    if (this.failing !== null) throw new Error(this.failing);
    const key = this.keys.get(kid);
    return key === undefined ? { found: false } : { found: true, key };
  }
}

export const MADE_UP_ITEM = 'item-made-up-0001';

// A webhook body as Plaid writes it: its own spacing, kept byte for byte.
export function webhookBody(type: string, code: string, extra: Record<string, unknown> = {}, itemId = MADE_UP_ITEM): string {
  return JSON.stringify({ webhook_type: type, webhook_code: code, item_id: itemId, environment: 'sandbox', ...extra }, null, 2);
}
