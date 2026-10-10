import type { IncomingMessage } from 'node:http';
import type { Auth, LoginResult, Session } from './auth.js';
import type { AuthState, LoginView } from '../views/login.js';
import { deviceOf } from './device.js';

// The login's own addresses (Step 2), answered for the web server
// (http/server.ts, which checks first that each POST came from the app's own
// address, and that the ones needing a login have one). Each answer is a
// status and a JSON body, and for a login or a log out the cookie to set.

export interface AuthAnswer {
  readonly status: number;
  readonly body: unknown;
  readonly setCookie?: string;
}

function field(body: unknown, name: string): unknown {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>)[name] : undefined;
}

function login(result: LoginResult): AuthAnswer {
  if (!result.ok) return { status: 422, body: result };
  return { status: 200, body: { ok: true }, setCookie: result.setCookie };
}

function answered(result: { readonly ok: boolean }): AuthAnswer {
  return { status: result.ok ? 200 : 422, body: result };
}

export async function answerAuth(auth: Auth, path: string, request: IncomingMessage, body: unknown, session: Session | null): Promise<AuthAnswer> {
  const device = deviceOf(request.headers['user-agent']);
  switch (path) {
    // Open: the login page's own.
    case '/api/auth':
      return { status: 200, body: { loggedIn: session !== null, passkeys: auth.hasPasskeys() } satisfies AuthState };
    case '/api/auth/login/options':
      return { status: 200, body: { ok: true, options: await auth.loginOptions() } };
    case '/api/auth/login':
      return login(await auth.login(field(body, 'response'), device));
    case '/api/auth/code/options':
      return answered(await auth.codeOptions(field(body, 'code')));
    case '/api/auth/code':
      return login(await auth.codePasskey(field(body, 'code'), field(body, 'response'), device));
  }
  // The rest need him logged in; the web server has checked.
  if (session === null) return { status: 401, body: { error: 'login-needed' } };
  switch (path) {
    case '/api/auth/passkey/options':
      return answered(await auth.passkeyOptions(session, field(body, 'confirmed') === true));
    case '/api/auth/passkey':
      return answered(await auth.addPasskey(session, field(body, 'response'), device));
    case '/api/auth/logout': {
      const { setCookie } = auth.logout(session);
      return { status: 200, body: { ok: true }, setCookie };
    }
    case '/api/auth/stay':
      return answered(auth.changeStayLoggedIn(session, field(body, 'days')));
    default:
      return { status: 404, body: { error: 'not-found' } };
  }
}

export function loginViewOf(auth: Auth, session: Session): LoginView {
  return { stayLoggedInDays: auth.stayLoggedInDays(), passkeys: auth.passkeys(), thisDevice: session.device };
}
