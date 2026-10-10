import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

// A passkey in software, for the server's tests only: it answers the
// browser's two WebAuthn questions (make a passkey, prove you have it) the
// way a phone or a laptop does, so the login can be tested end to end without
// a browser. The server checks what it sends with the passkey library
// (SimpleWebAuthn); nothing here is used by the app. Its own small CBOR
// writer covers only what an authenticator sends.

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
const sha256 = (data: Uint8Array | string): Buffer => createHash('sha256').update(data).digest();

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
}

type Cbor = number | string | Uint8Array | ReadonlyMap<number | string, Cbor>;

function cbor(value: Cbor): Buffer {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') return Buffer.concat([head(3, Buffer.byteLength(value)), Buffer.from(value)]);
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

interface Options {
  readonly challenge: string;
  readonly rp?: { readonly id?: string };
  readonly rpId?: string;
  readonly user?: { readonly id: string };
}

export class SoftPasskey {
  readonly id: Uint8Array = randomBytes(16);
  readonly #key: KeyObject;
  readonly #public: KeyObject;
  #count = 0;
  #userHandle = '';

  constructor() {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.#key = pair.privateKey;
    this.#public = pair.publicKey;
  }

  // What the browser sends back after navigator.credentials.create.
  // count: the use count it reports from then on; 0 is a passkey that counts
  // nothing, as Apple's passkeys do.
  register(options: Options, origin: string, change: { readonly rpId?: string; readonly type?: string; readonly userVerified?: boolean; readonly count?: number } = {}): unknown {
    const rpId = change.rpId ?? options.rp?.id ?? new URL(origin).hostname;
    if (change.count !== undefined) this.#count = change.count - 1;
    this.#userHandle = options.user?.id ?? '';
    const jwk = this.#public.export({ format: 'jwk' });
    const cose = new Map<number, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x ?? '', 'base64url')],
      [-3, Buffer.from(jwk.y ?? '', 'base64url')],
    ]);
    const attested = Buffer.concat([Buffer.alloc(16), Buffer.from([this.id.length >> 8, this.id.length & 0xff]), this.id, cbor(cose)]);
    const authData = Buffer.concat([this.#rp(rpId, change.userVerified ?? true, true), attested]);
    const clientData = JSON.stringify({ type: change.type ?? 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false });
    const attestation = cbor(new Map<string, Cbor>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    return {
      id: b64url(this.id),
      rawId: b64url(this.id),
      type: 'public-key',
      response: { clientDataJSON: b64url(Buffer.from(clientData)), attestationObject: b64url(attestation), transports: ['internal'] },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  // What the browser sends back after navigator.credentials.get.
  answer(options: Options, origin: string, change: { readonly rpId?: string; readonly count?: number; readonly userVerified?: boolean } = {}): unknown {
    const rpId = change.rpId ?? options.rpId ?? new URL(origin).hostname;
    if (change.count !== undefined) this.#count = change.count - 1;
    const authData = this.#rp(rpId, change.userVerified ?? true, false);
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.#key);
    return {
      id: b64url(this.id),
      rawId: b64url(this.id),
      type: 'public-key',
      response: { clientDataJSON: b64url(clientData), authenticatorData: b64url(authData), signature: b64url(signature), userHandle: this.#userHandle },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  #rp(rpId: string, userVerified: boolean, attested: boolean): Buffer {
    this.#count += 1;
    const flags = 0x01 | (userVerified ? 0x04 : 0) | (attested ? 0x40 : 0);
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.#count);
    return Buffer.concat([sha256(rpId), Buffer.from([flags]), count]);
  }
}
