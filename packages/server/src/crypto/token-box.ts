import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// CLAUDE.md safety rules: the Plaid access token lives on the server only,
// encrypted. It is sealed with AES-256-GCM under a key from the environment
// (BANK_TOKEN_KEY in .env), and bound to its connection, so a sealed token
// cannot be opened for another one, or changed, without that being caught.
// It is opened only for the moment a request needs it.
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class TokenBox {
  readonly #key: Buffer;

  constructor(keyBase64: string) {
    const text = keyBase64.trim();
    const key = Buffer.from(text, 'base64');
    if (key.length !== 32 || key.toString('base64') !== text) {
      throw new Error('BANK_TOKEN_KEY must be 32 random bytes written in base64 (44 characters)');
    }
    this.#key = key;
  }

  seal(token: string, connectionId: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(boundTo(connectionId));
    const sealed = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return [VERSION, iv.toString('base64url'), sealed.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
  }

  open(sealed: string, connectionId: string): string {
    try {
      const [version, iv, data, tag, ...rest] = sealed.split('.');
      if (version !== VERSION || iv === undefined || data === undefined || tag === undefined || rest.length > 0) throw new Error('bad form');
      const ivBytes = Buffer.from(iv, 'base64url');
      const tagBytes = Buffer.from(tag, 'base64url');
      if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) throw new Error('bad form');
      const decipher = createDecipheriv('aes-256-gcm', this.#key, ivBytes, { authTagLength: TAG_BYTES });
      decipher.setAAD(boundTo(connectionId));
      decipher.setAuthTag(tagBytes);
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      // Which of these it was is not said: wrong key, wrong connection, or changed.
      throw new Error('the stored bank key cannot be opened: wrong BANK_TOKEN_KEY, or the stored copy was changed');
    }
  }

  toJSON(): string {
    return '[TokenBox]';
  }

  toString(): string {
    return '[TokenBox]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return 'TokenBox { [hidden] }';
  }
}

function boundTo(connectionId: string): Buffer {
  return Buffer.from(`budget-app plaid access token for ${connectionId}`, 'utf8');
}

export function tokenBoxFromEnv(env: Readonly<Record<string, string | undefined>>): TokenBox {
  return new TokenBox(env['BANK_TOKEN_KEY'] ?? '');
}

// A fresh encryption key for BANK_TOKEN_KEY.
export function newTokenKey(): string {
  return randomBytes(32).toString('base64');
}
