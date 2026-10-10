import type { IsoDate } from '@budget-app/money';
import type { LoginView } from '@budget-app/server/views';
import { startRegistration } from '@simplewebauthn/browser';
import { useState } from 'react';
import { authSend, type Reload } from '../app/api.js';
import { BottomSheet, Button, ButtonRow, Card, ListRow, Notice, TextField } from '../ui/blocks.js';
import { dayWithYear } from '../ui/dates.js';
import type { Said } from './choose.js';
import { daysText } from './settings-text.js';

// Settings' Login card (Step 2), on the real server only: how long he stays
// logged in on a device (section 2), his passkeys, adding another (it asks
// first), and log out. The server checks and keeps all of it; the screen
// only asks.

type Sheet = 'stay' | 'passkey' | null;

const CANCELLED = 'The passkey was not made. Nothing was changed.';
const NO_SIGNAL = "Couldn't save that. Check your connection and try again. Nothing was changed.";

export function LoginCard({ login, onSaid, reload }: { readonly login: LoginView; readonly onSaid: (said: Said) => void; readonly reload: Reload }) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [opened, setOpened] = useState(0);
  const [busy, setBusy] = useState(false);
  const open = (which: Sheet): void => {
    setOpened((n) => n + 1);
    setSheet(which);
  };

  const logOut = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const reply = await authSend('/api/auth/logout', {});
      if (reply.ok) window.location.assign('/login');
      else onSaid({ tone: 'danger', text: reply.why });
    } catch {
      onSaid({ tone: 'danger', text: NO_SIGNAL });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title="Login" testId="login-card">
        <ListRow icon="clock" title="Stay logged in" detail={`${daysText(login.stayLoggedInDays)} on a device`} onClick={() => open('stay')} testId="row-stay-logged-in" />
        {login.passkeys.map((p, i) => (
          <ListRow key={`${p.createdAt}-${i}`} icon="lock" title={`Passkey: ${p.device}`} detail={`Made ${dayWithYear(p.createdAt.slice(0, 10) as IsoDate)}`} testId={`passkey-${i}`} />
        ))}
        <ListRow icon="lock" title="Add a passkey" detail="On the device you are using now" onClick={() => open('passkey')} testId="row-add-passkey" />
        <p className="card__note">This device: {login.thisDevice}.</p>
        <ButtonRow>
          <Button variant="secondary" wide disabled={busy} onClick={() => void logOut()} testId="logout">
            Log out
          </Button>
        </ButtonRow>
      </Card>
      {sheet === 'stay' && (
        <StaySheet
          key={`stay-${opened}`}
          days={login.stayLoggedInDays}
          onClose={() => setSheet(null)}
          onDone={(text) => {
            setSheet(null);
            onSaid({ tone: 'ok', text });
            reload('after');
          }}
        />
      )}
      {sheet === 'passkey' && (
        <PasskeySheet
          key={`passkey-${opened}`}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            onSaid({ tone: 'ok', text: 'Passkey added. It can log in on this device from now on.' });
            reload('after');
          }}
        />
      )}
    </>
  );
}

function StaySheet({ days, onClose, onDone }: { readonly days: number; readonly onClose: () => void; readonly onDone: (text: string) => void }) {
  const [text, setText] = useState(String(days));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const value = /^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : null;
  const save = async (): Promise<void> => {
    if (busy || value === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const reply = await authSend('/api/auth/stay', { days: value });
      if (reply.ok) onDone(`Stay logged in: ${daysText(value)} on a device, from now on.`);
      else setProblem(reply.why);
    } catch {
      setProblem(NO_SIGNAL);
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet open title="Stay logged in" onClose={onClose} testId="stay-sheet">
      {problem !== null && (
        <Notice tone="danger" icon="alert" testId="sheet-problem">
          {problem}
        </Notice>
      )}
      <TextField label="Days on a device" value={text} onChange={setText} kind="whole" hint="1 to 365. It applies right away, to every device logged in." testId="stay-days" />
      <Button wide disabled={busy || value === null} onClick={() => void save()} testId="sheet-save">
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </BottomSheet>
  );
}

// Adding a passkey asks first; with the yes, this device makes one.
function PasskeySheet({ onClose, onDone }: { readonly onClose: () => void; readonly onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const add = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const asked = await authSend('/api/auth/passkey/options', { confirmed: true });
      if (!asked.ok || asked.options === undefined) {
        setProblem(asked.ok ? NO_SIGNAL : asked.why);
        return;
      }
      const response = await startRegistration({ optionsJSON: asked.options as Parameters<typeof startRegistration>[0]['optionsJSON'] });
      const made = await authSend('/api/auth/passkey', { response });
      if (made.ok) onDone();
      else setProblem(made.why);
    } catch (error) {
      setProblem(error instanceof Error && error.name === 'NotAllowedError' ? CANCELLED : NO_SIGNAL);
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet open title="Add a passkey?" onClose={onClose} testId="passkey-sheet">
      {problem !== null && (
        <Notice tone="danger" icon="alert" testId="sheet-problem">
          {problem}
        </Notice>
      )}
      <Notice tone="warning" icon="alert" testId="confirm-ask">
        Add a passkey on this device? Anyone with it can open your budget.
      </Notice>
      <ButtonRow>
        <Button wide disabled={busy} onClick={() => void add()} testId="confirm-yes">
          {busy ? 'Waiting for your passkey…' : 'Yes, add a passkey'}
        </Button>
        <Button variant="secondary" wide disabled={busy} onClick={onClose} testId="confirm-cancel">
          Cancel
        </Button>
      </ButtonRow>
    </BottomSheet>
  );
}
