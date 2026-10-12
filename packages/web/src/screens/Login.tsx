import type { AuthState } from '@budget-app/server/views';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useEffect, useState } from 'react';
import { authSend, authState, type AuthReply } from '../app/api.js';
import { browserEndpoint } from '../app/push.js';
import { pathOf } from '../app/routes.js';
import { Button, ButtonRow, Card, Notice, Skeleton, StateMessage, TextField } from '../ui/blocks.js';

// The login page (Step 2): the only screen the real server shows without a
// login. With a passkey: one tap, and Face ID or the computer's own check.
// The first passkey (or a new one after losing them all) is made with the
// one-time code npm run serve prints in its own window (npm run login-code
// makes another). The checks are the server's; the browser only makes and
// uses the passkey. After a login, the app opens on Home.

type Page = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly state: AuthState };

const CANCELLED = 'The passkey was not used. Nothing was changed; try again when you are ready.';
const NO_SIGNAL = "Couldn't reach the app. Check that it is running on this computer, then try again.";

export function LoginScreen() {
  const [page, setPage] = useState<Page>({ status: 'loading' });
  const [useCode, setUseCode] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = (): void => {
    setPage({ status: 'loading' });
    authState().then(
      (state) => {
        if (state.loggedIn) window.location.assign(pathOf('home'));
        else setPage({ status: 'ready', state });
      },
      () => setPage({ status: 'error' }),
    );
  };
  useEffect(load, []);

  // One try: ask the server, let the browser make or use the passkey, send it back.
  const attempt = async (run: () => Promise<AuthReply>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const reply = await run();
      if (reply.ok) {
        window.location.assign(pathOf('home'));
        return;
      }
      setProblem(reply.why);
    } catch (error) {
      setProblem(error instanceof Error && error.name === 'NotAllowedError' ? CANCELLED : NO_SIGNAL);
    } finally {
      setBusy(false);
    }
  };

  // 10.11 (QUESTIONS.md A41): this phone's own push address, sent with the
  // login, so notifications it already gets move to the new login by
  // themselves. Asked after the passkey step, so nothing comes between his tap
  // and Face ID; none if the browser cannot say.
  const pushAddress = async (): Promise<string | null> => {
    try {
      return await browserEndpoint();
    } catch {
      return null;
    }
  };

  const logIn = (): Promise<void> =>
    attempt(async () => {
      const asked = await authSend('/api/auth/login/options', {});
      if (!asked.ok || asked.options === undefined) return asked;
      const response = await startAuthentication({ optionsJSON: asked.options as Parameters<typeof startAuthentication>[0]['optionsJSON'] });
      return authSend('/api/auth/login', { response, push: await pushAddress() });
    });

  const makePasskey = (): Promise<void> =>
    attempt(async () => {
      const asked = await authSend('/api/auth/code/options', { code });
      if (!asked.ok || asked.options === undefined) return asked;
      const response = await startRegistration({ optionsJSON: asked.options as Parameters<typeof startRegistration>[0]['optionsJSON'] });
      return authSend('/api/auth/code', { code, response, push: await pushAddress() });
    });

  const first = page.status === 'ready' && !page.state.passkeys;
  return (
    <main className="screen" aria-busy={page.status === 'loading'} data-testid="login">
      <h1 className="screen-title">Budget</h1>
      {page.status === 'loading' && (
        <div data-testid="login-loading" style={{ display: 'contents' }}>
          <span className="sr-only">Loading</span>
          <div className="card card--padded" aria-hidden="true" style={{ display: 'grid', gap: '12px' }}>
            <Skeleton width="60%" height="1rem" />
            <Skeleton width="80%" height="2.75rem" />
          </div>
        </div>
      )}
      {page.status === 'error' && (
        <StateMessage icon="alert" tone="danger" title="Couldn't reach the app" detail="Check that it is running on this computer, then try again." testId="login-error">
          <Button onClick={load} testId="retry">
            Try again
          </Button>
        </StateMessage>
      )}
      {problem !== null && (
        <Notice tone="danger" icon="alert" testId="login-problem">
          {problem}
        </Notice>
      )}
      {page.status === 'ready' && !first && !useCode && (
        <Card padded testId="login-passkey">
          <p className="card__note">Log in with the passkey on this device: Face ID, Touch ID, or this computer's own check.</p>
          <Button wide disabled={busy} onClick={() => void logIn()} testId="login-passkey-button">
            {busy ? 'Waiting for your passkey…' : 'Log in with a passkey'}
          </Button>
          <ButtonRow>
            <Button variant="plain" wide disabled={busy} onClick={() => setUseCode(true)} testId="use-code">
              Lost your passkeys? Use a one-time code
            </Button>
          </ButtonRow>
        </Card>
      )}
      {page.status === 'ready' && (first || useCode) && (
        <Card padded testId="login-code">
          <p className="card__note" data-testid="code-how">
            {first
              ? 'Make your first passkey. The one-time code is in the window where npm run serve is running.'
              : 'On the computer the app runs on, npm run login-code prints a one-time code. It makes a new passkey on this device.'}
          </p>
          <TextField label="One-time code" value={code} onChange={setCode} kind="whole" hint="12 digits. Good once, for 15 minutes." testId="code" />
          <Button wide disabled={busy || code.trim() === ''} onClick={() => void makePasskey()} testId="make-passkey">
            {busy ? 'Waiting for your passkey…' : 'Make a passkey'}
          </Button>
          {!first && (
            <Button variant="plain" wide disabled={busy} onClick={() => setUseCode(false)} testId="use-passkey">
              Log in with a passkey instead
            </Button>
          )}
        </Card>
      )}
    </main>
  );
}
