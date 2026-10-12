import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { Agent, createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import selfsigned from 'selfsigned';
import { decide, payloadOf, type Shown as Notification } from '../../web/src/push/rules.js';
import type { PushOnRequest, PushPayload } from '../src/views/push.js';

// Phase 5, the phone, for the tests: a made-up push service on this computer,
// and the phones it serves. The real sender (src/push/push-sender.ts) sends
// to it through the web-push library exactly as it would to Apple's: over
// HTTPS (a certificate made for 127.0.0.1 when it starts, never kept), with
// the request signed with the app's own key (VAPID, RFC 8292) and the alert
// encrypted for one phone (RFC 8291, aes128gcm). It checks the signature and
// that the key is the one the phone subscribed with, opens the alert with
// that phone's private key, and hands it to the phone, which follows the
// service worker's own rules (packages/web/src/push/rules.ts): each alert
// shown with its id as its tag, a repeat dropped. A phone can be made to be
// unreachable (its push service answers 500) or gone (410 or 404), as a real one can.
// Nothing here can reach anything but this computer.

export interface ShownAlert extends PushPayload {
  // When it reached the phone, as an instant.
  readonly at: string;
  // What the phone showed for it.
  readonly notification: Notification;
}

export interface Received {
  readonly phone: string;
  readonly status: number;
  readonly ttl: string | undefined;
  readonly topic: string | undefined;
  readonly urgency: string | undefined;
}

const b64 = (bytes: Buffer): string => bytes.toString('base64url');

export class TestPhone {
  readonly id: string;
  readonly endpoint: string;
  readonly #ecdh = createECDH('prime256v1');
  readonly #auth = randomBytes(16);
  readonly #now: () => Date;
  readonly shown: ShownAlert[] = [];
  readonly #shownIds = new Set<string>();
  // Pushes with an id already shown (a try the server could not mark as done): dropped.
  repeats = 0;
  // Every push its push service was asked to deliver, delivered or not.
  tries = 0;
  // While set, its push service cannot deliver to it: it answers 500.
  failing: string | null = null;
  // Its subscription is gone: its push service answers 410 Gone, or 404 Not
  // Found (a push service may answer either).
  gone = false;
  goneAs: 404 | 410 = 410;
  // For one push: what happens once it is shown, before the server hears back.
  afterShowing: ((alert: ShownAlert) => void) | null = null;

  constructor(id: string, base: string, now: () => Date) {
    this.id = id;
    this.endpoint = `${base}/push/${id}`;
    this.#ecdh.generateKeys();
    this.#now = now;
  }

  // What the phone's browser hands the app when he turns notifications on.
  subscription(): PushOnRequest {
    return { endpoint: this.endpoint, keys: { p256dh: b64(this.#ecdh.getPublicKey()), auth: b64(this.#auth) } };
  }

  ids(): string[] {
    return this.shown.map((s) => s.id);
  }

  // RFC 8291 and RFC 8188: one aes128gcm record, opened with this phone's keys.
  decrypt(body: Buffer): string {
    const salt = body.subarray(0, 16);
    const idLength = body.readUInt8(20);
    const senderKey = body.subarray(21, 21 + idLength);
    const ciphertext = body.subarray(21 + idLength);
    const secret = this.#ecdh.computeSecret(senderKey);
    const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), this.#ecdh.getPublicKey(), senderKey]);
    const ikm = Buffer.from(hkdfSync('sha256', secret, this.#auth, keyInfo, 32));
    const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
    // The last record ends with 2, then any padding of zeros.
    let end = padded.length - 1;
    while (end >= 0 && padded[end] === 0) end -= 1;
    if (padded[end] !== 2) throw new Error('not the last record of an aes128gcm message');
    return padded.subarray(0, end).toString('utf8');
  }

  // What its service worker does with a push (the same rules as sw.ts).
  receive(text: string): void {
    const p = payloadOf(text);
    const d = decide(p, p !== null && this.#shownIds.has(p.id));
    if ('repeat' in d) {
      this.repeats += 1;
      return;
    }
    if (p === null) throw new Error(`the phone ${this.id} got a push it cannot read: ${text}`);
    this.#shownIds.add(p.id);
    const shown: ShownAlert = { ...p, at: this.#now().toISOString(), notification: d.show };
    this.shown.push(shown);
    const after = this.afterShowing;
    this.afterShowing = null;
    after?.(shown);
  }
}

export class FakePushService {
  readonly #server: Server;
  readonly base: string;
  // For the real sender: trusts this service's certificate, and nothing else.
  readonly agent: Agent;
  readonly #phones = new Map<string, TestPhone>();
  readonly received: Received[] = [];
  // Pushes that were not what the app must send (not signed by it, not
  // encrypted, not readable): a test that sees any fails.
  readonly problems: string[] = [];
  readonly #now: () => Date;
  // The app's public key (VAPID): the only one this service takes alerts from.
  readonly #serverKey: string;
  #next = 0;

  private constructor(server: Server, base: string, cert: string, now: () => Date, serverKey: string) {
    this.#server = server;
    this.base = base;
    this.agent = new Agent({ ca: cert, keepAlive: false });
    this.#now = now;
    this.#serverKey = serverKey;
  }

  static async start(input: { readonly now: () => Date; readonly serverKey: string }): Promise<FakePushService> {
    const pems = await selfsigned.generate([{ name: 'commonName', value: '127.0.0.1' }], { keyType: 'ec', curve: 'P-256', notAfterDate: new Date(Date.now() + 2 * 86_400_000), extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }] });
    let service: FakePushService | undefined;
    const server = createServer({ key: pems.private, cert: pems.cert }, (request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let status = 503;
        try {
          status = service?.take(request.url ?? '', request.headers, Buffer.concat(chunks)) ?? 503;
        } catch (error) {
          // A push the app should never send: kept for the test to fail on, and refused.
          service?.problems.push(error instanceof Error ? error.message : String(error));
          status = 400;
        }
        response.statusCode = status;
        response.setHeader('Connection', 'close');
        response.end();
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const base = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
    service = new FakePushService(server, base, pems.cert, input.now, input.serverKey);
    return service;
  }

  newPhone(): TestPhone {
    this.#next += 1;
    const phone = new TestPhone(`phone-${this.#next}`, this.base, this.#now);
    this.#phones.set(phone.id, phone);
    return phone;
  }

  async close(): Promise<void> {
    this.agent.destroy();
    this.#server.closeAllConnections();
    await new Promise<void>((done) => this.#server.close(() => done()));
  }

  // One push as Apple's would take it: the right address, signed by the app,
  // encrypted for the phone.
  take(url: string, headers: Readonly<Record<string, string | string[] | undefined>>, body: Buffer): number {
    const id = /^\/push\/([a-z0-9-]+)$/.exec(url)?.[1];
    const phone = id === undefined ? undefined : this.#phones.get(id);
    const note = (status: number): number => {
      this.received.push({ phone: id ?? url, status, ttl: one(headers['ttl']), topic: one(headers['topic']), urgency: one(headers['urgency']) });
      return status;
    };
    if (phone === undefined) return note(404);
    phone.tries += 1;
    if (phone.gone) return note(phone.goneAs);
    if (phone.failing !== null) return note(500);
    const problem = this.#signatureProblem(one(headers['authorization']));
    if (problem !== null) throw new Error(`the push to ${phone.id} was not signed by the app: ${problem}`);
    if (one(headers['content-encoding']) !== 'aes128gcm') throw new Error(`the push to ${phone.id} was not aes128gcm`);
    phone.receive(phone.decrypt(body));
    return note(201);
  }

  // RFC 8292: "vapid t=<JWT>, k=<the app's public key>", the JWT signed with
  // ES256 by the app's private key, for this service's origin, not expired.
  #signatureProblem(authorization: string | undefined): string | null {
    const m = /^vapid t=([^,\s]+),\s*k=([A-Za-z0-9_-]+)$/.exec(authorization ?? '');
    if (m === null) return 'no vapid Authorization header';
    const [, jwt = '', key = ''] = m;
    if (key !== this.#serverKey) return 'signed with another key than the one the phone subscribed with';
    const [header = '', claims = '', signature = ''] = jwt.split('.');
    const raw = Buffer.from(key, 'base64url');
    const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64(raw.subarray(1, 33)), y: b64(raw.subarray(33, 65)) }, format: 'jwk' });
    if (!verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))) return 'the signature does not verify';
    const c = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as { aud?: unknown; exp?: unknown; sub?: unknown };
    if (c.aud !== this.base) return `for ${String(c.aud)}, not ${this.base}`;
    // web-push signs for 12 hours from the real clock.
    if (typeof c.exp !== 'number' || c.exp * 1000 < Date.now()) return 'expired';
    if (typeof c.sub !== 'string' || !/^(mailto:|https:)/.test(c.sub)) return 'no subject';
    return null;
  }
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
