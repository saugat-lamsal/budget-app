import type { PushView } from '@budget-app/server/views';
import { useEffect, useRef, useState } from 'react';
import type { Reload } from '../app/api.js';
import { browserEndpoint, permission, sendTestAlert, support, turnOff, turnOn } from '../app/push.js';
import { Button, ButtonRow, Card, ListRow } from '../ui/blocks.js';
import type { IconName } from '../ui/Icon.js';
import type { Said } from './choose.js';
import { NOTIFICATION_DONE, NOTIFICATION_NO_SIGNAL, cardState, cardWords, type CardState, type DeviceFacts } from './notifications-text.js';

// Settings' Notifications card (Phase 5), on the real server only: whether
// this phone gets the alerts, in words; Turn on (only from his tap: the phone
// asks him then), Turn off, and Send a test alert. The server keeps which
// devices have them on; the alerts themselves go out as the outbox says.

async function readFacts(): Promise<DeviceFacts> {
  const can = support();
  return { support: can, permission: can === 'yes' ? permission() : 'default', endpoint: can === 'yes' ? await browserEndpoint().catch(() => null) : null };
}

const ICONS: Readonly<Record<CardState['kind'], IconName>> = {
  checking: 'clock',
  'no-keys': 'info',
  'home-screen-first': 'info',
  'not-secure': 'info',
  'not-this-browser': 'info',
  blocked: 'alert',
  on: 'check',
  off: 'bell',
};

type Act = 'on' | 'off' | 'test';

export function NotificationsCard({ push, onSaid, reload }: { readonly push: PushView; readonly onSaid: (said: Said) => void; readonly reload: Reload }) {
  const [facts, setFacts] = useState<DeviceFacts | null>(null);
  const [busy, setBusy] = useState<Act | null>(null);
  // Nor after an answer, while Settings still shows the numbers from before it
  // (B244, as B92 and B192 elsewhere): the card can say Off then, with Turn on
  // under the second tap of a double tap (on Turn off, too). The buttons stay
  // off until the numbers asked for after the answer are shown.
  const shown = useRef(push);
  shown.current = push;
  const [answered, setAnswered] = useState<{ readonly on: PushView; readonly act: Act } | null>(null);
  const doing = busy ?? (answered !== null && answered.on === push ? answered.act : null);
  // What the browser can do and has, looked at again whenever the server's numbers come.
  useEffect(() => {
    let live = true;
    void readFacts().then((found) => {
      if (live) setFacts(found);
    });
    return () => {
      live = false;
    };
  }, [push]);

  const state = cardState(push, facts);
  const words = cardWords(state);
  // Each button is off while one is on its way (a second tap does nothing).
  const run = async (which: Act, act: () => Promise<{ readonly ok: boolean; readonly why?: string }>, done: string): Promise<void> => {
    setBusy(which);
    try {
      const answer = await act();
      onSaid(answer.ok ? { tone: 'ok', text: done } : { tone: 'danger', text: answer.why ?? NOTIFICATION_NO_SIGNAL });
    } catch {
      onSaid({ tone: 'danger', text: NOTIFICATION_NO_SIGNAL });
    } finally {
      setAnswered({ on: shown.current, act: which });
      setBusy(null);
      setFacts(await readFacts());
      reload('after');
    }
  };

  return (
    <Card title="Notifications" testId="notifications-card">
      <ListRow icon={ICONS[state.kind]} tone={state.kind === 'blocked' ? 'warning' : 'info'} title={words.title} detail={words.detail} testId="notifications-state" />
      {state.kind === 'off' && push.state === 'ready' && (
        <ButtonRow>
          <Button wide disabled={doing !== null} onClick={() => void run('on', () => turnOn(push.publicKey), NOTIFICATION_DONE.on)} testId="notifications-on">
            {doing === 'on' ? 'Turning on…' : 'Turn on'}
          </Button>
        </ButtonRow>
      )}
      {state.kind === 'on' && (
        <ButtonRow>
          <Button variant="secondary" wide disabled={doing !== null} onClick={() => void run('test', sendTestAlert, NOTIFICATION_DONE.test)} testId="notifications-test">
            Send a test alert
          </Button>
          <Button variant="secondary" wide disabled={doing !== null} onClick={() => void run('off', turnOff, NOTIFICATION_DONE.off)} testId="notifications-off">
            Turn off
          </Button>
        </ButtonRow>
      )}
    </Card>
  );
}
