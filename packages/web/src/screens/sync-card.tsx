import type { SyncView } from '@budget-app/server/views';
import { useState } from 'react';
import { sendSyncEvery, type Reload } from '../app/api.js';
import { BottomSheet, Button, Card, ListRow, Notice, TextField } from '../ui/blocks.js';
import { checkedAtText } from '../ui/dates.js';
import type { Said } from './choose.js';
import { minutesText } from './settings-text.js';

// Settings' Bank card (Step 3), on the real server only: how often it syncs
// with the bank by itself (section 2), and when it last read it. The server
// checks and keeps the setting; the screen only asks.

const NO_SIGNAL = "Couldn't save that. Check your connection and try again. Nothing was changed.";

export function SyncCard({ sync, onSaid, reload }: { readonly sync: SyncView; readonly onSaid: (said: Said) => void; readonly reload: Reload }) {
  const [open, setOpen] = useState(0);
  const checked = sync.checkedAt === null ? 'Not read yet' : `Checked at ${checkedAtText(sync.checkedAt.at, sync.today, sync.checkedAt.timeZone)}`;
  return (
    <>
      <Card title="Bank" testId="sync-card">
        <ListRow icon="clock" title="Sync with the bank" detail={`Every ${minutesText(sync.everyMinutes)} · ${checked}`} onClick={() => setOpen((n) => n + 1)} testId="row-sync-every" />
        <ListRow icon="bank" title="Bank connection" detail="Connect, log in again, which account is which" href="/bank" testId="row-bank-connection" />
      </Card>
      {open > 0 && (
        <SyncSheet
          key={`sync-${open}`}
          minutes={sync.everyMinutes}
          onClose={() => setOpen(0)}
          onDone={(text) => {
            setOpen(0);
            onSaid({ tone: 'ok', text });
            reload('after');
          }}
        />
      )}
    </>
  );
}

function SyncSheet({ minutes, onClose, onDone }: { readonly minutes: number; readonly onClose: () => void; readonly onDone: (text: string) => void }) {
  const [text, setText] = useState(String(minutes));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const value = /^\d{1,5}$/.test(text.trim()) ? Number(text.trim()) : null;
  const save = async (): Promise<void> => {
    if (busy || value === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const reply = await sendSyncEvery(value);
      if (reply.ok) onDone(`Sync with the bank: every ${minutesText(value)}, from now on.`);
      else setProblem(reply.why);
    } catch {
      setProblem(NO_SIGNAL);
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet open title="Sync with the bank" onClose={onClose} testId="sync-sheet">
      {problem !== null && (
        <Notice tone="danger" icon="alert" testId="sheet-problem">
          {problem}
        </Notice>
      )}
      <TextField label="Every how many minutes" value={text} onChange={setText} kind="whole" hint="15 to 1,440 (once a day). It applies right away." testId="sync-minutes" />
      <Button wide disabled={busy || value === null} onClick={() => void save()} testId="sheet-save">
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </BottomSheet>
  );
}
