import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// Phase 6, the backups, for the tests: a stand-in for Cloudflare R2 on this
// computer. Litestream copies the books to it exactly as it would to R2,
// through the same S3 calls: each request must be signed with the bucket's
// key (AWS Signature Version 4, checked here in full), and what it uploads is
// kept in memory, so a test can restore from it, look at it, take it away,
// or spoil it. It answers only on 127.0.0.1, and only for its own bucket and
// key, which are made up each time. Nothing here can reach a real bucket
// (test/backup-only-here.test.ts).
//
// The calls Litestream makes: put, get (whole or a range), head, list
// (ListObjectsV2), delete one, and delete many. Anything else is answered
// "not implemented", so a test sees it at once.

export interface StoredObject {
  readonly body: Buffer;
  readonly etag: string;
  readonly lastModified: Date;
}

export interface R2Request {
  readonly method: string;
  readonly operation: string;
  readonly key: string;
  readonly status: number;
}

const XML = 'application/xml';
const randomName = (): string => `made-up-${Math.random().toString(36).slice(2, 10)}`;

// RFC 3986, as S3 wants it in a signature: everything but A-Z a-z 0-9 - _ . ~.
function encode(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function unescapeXml(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest();

export class FakeR2 {
  readonly bucket = randomName();
  readonly accessKeyId = `MADEUP${Math.random().toString(36).slice(2, 14).toUpperCase()}`;
  readonly secretAccessKey = `made-up-secret-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  readonly objects = new Map<string, StoredObject>();
  readonly requests: R2Request[] = [];
  // While set, every request is answered with this status (the bucket cannot be reached, or turns everything away).
  failing: number | null = null;
  readonly #server: Server;
  #port = 0;

  private constructor() {
    this.#server = createServer((request, response) => {
      this.#answer(request, response).catch(() => {
        if (!response.headersSent) this.#error(response, 500, 'InternalError', 'The stand-in failed.');
      });
    });
  }

  static async start(): Promise<FakeR2> {
    const r2 = new FakeR2();
    await new Promise<void>((resolve) => r2.#server.listen(0, '127.0.0.1', resolve));
    r2.#port = (r2.#server.address() as AddressInfo).port;
    return r2;
  }

  get endpoint(): string {
    return `http://127.0.0.1:${this.#port}`;
  }

  // What the server's environment holds for the backups, pointing here.
  env(): Record<string, string> {
    return { R2_ENDPOINT: this.endpoint, R2_BUCKET: this.bucket, R2_ACCESS_KEY_ID: this.accessKeyId, R2_SECRET_ACCESS_KEY: this.secretAccessKey };
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  async #answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const url = request.url ?? '/';
    const [rawPath = '/', rawQuery = ''] = url.split('?', 2);
    const query = new Map<string, string>();
    for (const pair of rawQuery.split('&').filter((p) => p !== '')) {
      const [k = '', v = ''] = pair.split('=', 2);
      query.set(decodeURIComponent(k), decodeURIComponent(v));
    }
    const segments = rawPath.split('/').slice(1);
    const bucket = decodeURIComponent(segments[0] ?? '');
    const key = segments.slice(1).map(decodeURIComponent).join('/');
    const method = request.method ?? 'GET';
    const operation = this.#operationOf(method, key, query);
    const record = (status: number): void => {
      this.requests.push({ method, operation, key, status });
    };

    if (this.failing !== null) {
      record(this.failing);
      this.#error(response, this.failing, 'ServiceUnavailable', 'The stand-in is turning everything away.');
      return;
    }
    const refused = this.#signatureProblem(request, rawPath, rawQuery, body);
    if (refused !== null) {
      record(403);
      this.#error(response, 403, refused.code, refused.message);
      return;
    }
    if (bucket !== this.bucket) {
      record(404);
      this.#error(response, 404, 'NoSuchBucket', 'The specified bucket does not exist.');
      return;
    }
    const md5 = request.headers['content-md5'];
    if (typeof md5 === 'string' && createHash('md5').update(body).digest('base64') !== md5) {
      record(400);
      this.#error(response, 400, 'BadDigest', 'The Content-MD5 you specified did not match what was received.');
      return;
    }

    switch (operation) {
      case 'HeadBucket':
        record(200);
        response.writeHead(200).end();
        return;
      case 'GetBucketLocation':
        record(200);
        this.#xml(response, 200, '<LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">auto</LocationConstraint>');
        return;
      case 'ListObjectsV2':
        record(200);
        this.#xml(response, 200, this.#list(query));
        return;
      case 'PutObject': {
        const etag = `"${createHash('md5').update(body).digest('hex')}"`;
        this.objects.set(key, { body, etag, lastModified: new Date() });
        record(200);
        response.writeHead(200, { ETag: etag }).end();
        return;
      }
      case 'GetObject':
      case 'HeadObject': {
        const object = this.objects.get(key);
        if (object === undefined) {
          record(404);
          if (operation === 'HeadObject') response.writeHead(404).end();
          else this.#error(response, 404, 'NoSuchKey', 'The specified key does not exist.');
          return;
        }
        const headers = { ETag: object.etag, 'Last-Modified': object.lastModified.toUTCString(), 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes' };
        const range = /^bytes=(\d+)-(\d*)$/.exec(String(request.headers.range ?? ''));
        if (range !== null && operation === 'GetObject') {
          const start = Number(range[1]);
          const end = range[2] === '' ? object.body.length - 1 : Math.min(Number(range[2]), object.body.length - 1);
          if (start >= object.body.length) {
            record(416);
            this.#error(response, 416, 'InvalidRange', 'The requested range is not satisfiable.');
            return;
          }
          const part = object.body.subarray(start, end + 1);
          record(206);
          response.writeHead(206, { ...headers, 'Content-Length': part.length, 'Content-Range': `bytes ${start}-${end}/${object.body.length}` }).end(part);
          return;
        }
        record(200);
        response.writeHead(200, { ...headers, 'Content-Length': object.body.length }).end(operation === 'HeadObject' ? undefined : object.body);
        return;
      }
      case 'DeleteObject':
        this.objects.delete(key);
        record(204);
        response.writeHead(204).end();
        return;
      case 'DeleteObjects': {
        const keys = [...body.toString('utf8').matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((m) => unescapeXml(m[1] ?? ''));
        for (const k of keys) this.objects.delete(k);
        record(200);
        this.#xml(response, 200, `<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${keys.map((k) => `<Deleted><Key>${escapeXml(k)}</Key></Deleted>`).join('')}</DeleteResult>`);
        return;
      }
      default:
        record(501);
        this.#error(response, 501, 'NotImplemented', `The stand-in does not do ${operation}.`);
    }
  }

  #operationOf(method: string, key: string, query: Map<string, string>): string {
    if (key === '') {
      if (method === 'HEAD') return 'HeadBucket';
      if (method === 'GET' && query.has('location')) return 'GetBucketLocation';
      if (method === 'GET' && query.get('list-type') === '2') return 'ListObjectsV2';
      if (method === 'POST' && query.has('delete')) return 'DeleteObjects';
      return `${method} bucket ${[...query.keys()].join(',')}`;
    }
    if (query.has('uploads') || query.has('uploadId')) return 'Multipart';
    if (method === 'PUT') return 'PutObject';
    if (method === 'GET') return 'GetObject';
    if (method === 'HEAD') return 'HeadObject';
    if (method === 'DELETE') return 'DeleteObject';
    return `${method} object`;
  }

  // AWS Signature Version 4, in the Authorization header, checked in full:
  // the key, the request as signed, and the payload's hash when it is signed.
  #signatureProblem(request: IncomingMessage, rawPath: string, rawQuery: string, body: Buffer): { code: string; message: string } | null {
    const auth = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, ?SignedHeaders=([^,]+), ?Signature=([0-9a-f]{64})$/.exec(String(request.headers.authorization ?? ''));
    if (auth === null) return { code: 'AccessDenied', message: 'Every request must be signed.' };
    const [, keyId, date, region, service, signedHeaders, signature] = auth as unknown as [string, string, string, string, string, string, string];
    if (keyId !== this.accessKeyId) return { code: 'InvalidAccessKeyId', message: 'The access key you gave is not this bucket\'s.' };
    const amzDate = String(request.headers['x-amz-date'] ?? '');
    if (!amzDate.startsWith(date)) return { code: 'AccessDenied', message: 'The date signed is not the request\'s.' };
    const payload = String(request.headers['x-amz-content-sha256'] ?? '');
    if (payload !== 'UNSIGNED-PAYLOAD' && payload !== sha256(body)) return { code: 'XAmzContentSHA256Mismatch', message: 'The body is not what was signed.' };
    const query = rawQuery
      .split('&')
      .filter((p) => p !== '')
      .map((pair) => {
        const [k = '', v = ''] = pair.split('=', 2);
        return [encode(decodeURIComponent(k)), encode(decodeURIComponent(v))] as const;
      })
      .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const names = signedHeaders.split(';');
    const headers = names.map((name) => `${name}:${String(request.headers[name] ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
    const canonical = [request.method ?? 'GET', rawPath, query, headers, signedHeaders, payload].join('\n');
    const scope = `${date}/${region}/${service}/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.secretAccessKey}`, date), region), service), 'aws4_request');
    const expected = Buffer.from(createHmac('sha256', signingKey).update(toSign).digest('hex'));
    if (!timingSafeEqual(expected, Buffer.from(signature))) return { code: 'SignatureDoesNotMatch', message: 'The request signature does not match.' };
    return null;
  }

  #list(query: Map<string, string>): string {
    const prefix = query.get('prefix') ?? '';
    const delimiter = query.get('delimiter') ?? '';
    const max = Math.min(Number(query.get('max-keys') ?? '1000'), 1000);
    const after = query.get('continuation-token') ?? query.get('start-after') ?? '';
    const contents: string[] = [];
    const prefixes = new Set<string>();
    let truncated = false;
    let last = '';
    for (const key of this.keys()) {
      if (!key.startsWith(prefix) || (after !== '' && key <= after)) continue;
      if (contents.length + prefixes.size >= max) {
        truncated = true;
        break;
      }
      const rest = key.slice(prefix.length);
      const cut = delimiter === '' ? -1 : rest.indexOf(delimiter);
      if (cut >= 0) prefixes.add(prefix + rest.slice(0, cut + delimiter.length));
      else {
        const o = this.objects.get(key) as StoredObject;
        contents.push(`<Contents><Key>${escapeXml(key)}</Key><LastModified>${o.lastModified.toISOString()}</LastModified><ETag>${escapeXml(o.etag)}</ETag><Size>${o.body.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`);
      }
      last = key;
    }
    const common = [...prefixes].map((p) => `<CommonPrefixes><Prefix>${escapeXml(p)}</Prefix></CommonPrefixes>`).join('');
    return `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${this.bucket}</Name><Prefix>${escapeXml(prefix)}</Prefix><KeyCount>${contents.length + prefixes.size}</KeyCount><MaxKeys>${max}</MaxKeys><IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${escapeXml(last)}</NextContinuationToken>` : ''}${contents.join('')}${common}</ListBucketResult>`;
  }

  #xml(response: ServerResponse, status: number, body: string): void {
    const text = `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
    response.writeHead(status, { 'Content-Type': XML, 'Content-Length': Buffer.byteLength(text) }).end(text);
  }

  #error(response: ServerResponse, status: number, code: string, message: string): void {
    this.#xml(response, status, `<Error><Code>${code}</Code><Message>${escapeXml(message)}</Message></Error>`);
  }
}
