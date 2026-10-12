import webpush from 'web-push';

// The app's own key pair for web push (VAPID, RFC 8292), read from the
// environment (.env, which git ignores) and nowhere else. The public half goes
// to the phone when he turns notifications on, so its push service takes
// alerts only from this server; the private half signs each alert and never
// leaves the server: it is not in any view, log line or answer (printing or
// logging the keys shows nothing). The subject is how the push service can
// reach whoever runs the server: a mailto: or https: address.
// npm run push-keys makes a pair to put in .env.

export interface PushKeys {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
}

// Base64url, as web push writes keys: a P-256 public key (65 bytes) and its
// private key (32 bytes).
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const bytesOf = (key: string): number => (BASE64URL.test(key) ? Buffer.from(key, 'base64url').length : -1);

// The keys, or null when none are set (the server then writes each alert in
// its own window, as before). Set but wrong: an error, which says what is
// wrong without repeating the keys.
export function pushKeysFromEnv(env: Readonly<Record<string, string | undefined>>): PushKeys | null {
  const publicKey = env['VAPID_PUBLIC_KEY']?.trim() ?? '';
  const privateKey = env['VAPID_PRIVATE_KEY']?.trim() ?? '';
  const subject = env['VAPID_SUBJECT']?.trim() ?? '';
  if (publicKey === '' && privateKey === '' && subject === '') return null;
  if (bytesOf(publicKey) !== 65) throw new Error('VAPID_PUBLIC_KEY in .env is not a web push public key (npm run push-keys makes a pair)');
  if (bytesOf(privateKey) !== 32) throw new Error('VAPID_PRIVATE_KEY in .env is not a web push private key (npm run push-keys makes a pair)');
  if (!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject)) throw new Error('VAPID_SUBJECT in .env must be a mailto: or https: address');
  return sealed({ publicKey, privateKey, subject });
}

// A new pair (npm run push-keys, and the tests' own, made fresh each run).
export function newPushKeys(subject: string): PushKeys {
  const { publicKey, privateKey } = webpush.generateVAPIDKeys();
  return sealed({ publicKey, privateKey, subject });
}

function sealed(keys: PushKeys): PushKeys {
  const out = {};
  Object.defineProperties(out, {
    publicKey: { value: keys.publicKey, enumerable: true },
    subject: { value: keys.subject, enumerable: true },
    privateKey: { value: keys.privateKey, enumerable: false },
    toJSON: { value: () => ({ publicKey: keys.publicKey, subject: keys.subject }), enumerable: false },
    toString: { value: () => '[push keys]', enumerable: false },
  });
  return out as PushKeys;
}
