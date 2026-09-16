/**
 * The operator's Credits page: every workspace, what it holds, what it has
 * spent and what it has stopped.
 *
 * TrueCourse staff only. It is not in the sidebar and the routes behind it
 * answer 404 to anyone else, so a member who lands here is told there is
 * nothing at this address rather than shown the shape of what they cannot have.
 *
 * Two actions, both on one workspace: GRANT hands it credits and, unless the
 * box is unticked, carries on everything it had paused; ADJUST is a correction
 * either way and starts nothing.
 */

import { useCallback, useEffect, useState } from 'react';
import { Coins } from 'lucide-react';
import { usdOfCredits, type OperatorCreditsRow } from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { formatUsd, startedLabel } from '@/components/sessions/run-model';
import { adjustCredits, fetchOperatorCredits, grantCredits } from '@/lib/api';
import { useAuth } from '@/auth/AuthContext';
import { EntityList } from '@/dashboard/ui/entity-list';
import { PageHeader } from '@/dashboard/ui/bits';
import { StatusWord } from '@/dashboard/ui/status-word';

const FIELD =
  'w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

/** Which movement the open form is for. */
type Movement = 'grant' | 'adjust';

function credits(value: number): string {
  return value.toLocaleString();
}

export default function OperatorCreditsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<OperatorCreditsRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ org: string; movement: Movement } | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [resumePaused, setResumePaused] = useState(true);
  const [busy, setBusy] = useState(false);

  const read = useCallback(() => {
    void fetchOperatorCredits()
      .then((next) => {
        setRows(next.workspaces);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(read, [read]);

  const close = useCallback(() => {
    setOpen(null);
    setAmount('');
    setNote('');
    setResumePaused(true);
  }, []);

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!open) return;
      const value = Number.parseInt(amount, 10);
      if (!Number.isFinite(value) || value === 0) {
        setError('Say how many credits, as a whole number.');
        return;
      }
      setBusy(true);
      setError(null);
      const body = {
        workspaceOrgId: open.org,
        credits: value,
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      const sent =
        open.movement === 'grant'
          ? grantCredits({ ...body, resumePaused })
          : adjustCredits(body);
      void sent
        .then(() => {
          close();
          read();
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setBusy(false));
    },
    [amount, close, note, open, read, resumePaused],
  );

  // The page is the operator's; a member reaching it is told the same thing the
  // routes tell them.
  if (!user?.isOperator) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader title="Not found" />
        <div className="min-h-0 flex-1 py-10">
          <EmptyState icon={Coins} title="Nothing here" body="There is no such page." />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Credits" />

      {error && (
        <p className="border-b border-border px-6 py-3 text-[11px] text-destructive">{error}</p>
      )}

      {open && (
        <form
          onSubmit={submit}
          aria-label={open.movement === 'grant' ? 'Grant credits' : 'Adjust credits'}
          className="border-b border-border px-6 py-4"
        >
          <p className="text-[11px] text-muted-foreground">
            {open.movement === 'grant' ? 'Grant credits to' : 'Adjust the balance of'}{' '}
            <span className="font-mono text-foreground">{open.org}</span>
          </p>
          <div className="mt-2 flex max-w-2xl flex-wrap items-end gap-3">
            <label className="block text-[11px] font-medium text-muted-foreground">
              Credits
              <input
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={open.movement === 'grant' ? '10000' : '-500'}
                className={`${FIELD} mt-1 w-28 font-mono`}
              />
            </label>
            <label className="block flex-1 text-[11px] font-medium text-muted-foreground">
              Note
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What this is for"
                className={`${FIELD} mt-1`}
              />
            </label>
            {open.movement === 'grant' && (
              <label className="flex items-center gap-1.5 pb-1.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={resumePaused}
                  onChange={(e) => setResumePaused(e.target.checked)}
                />
                Resume paused runs
              </label>
            )}
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Saving…' : open.movement === 'grant' ? 'Grant' : 'Adjust'}
            </button>
            <button
              type="button"
              onClick={close}
              className="rounded border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted/60"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {rows !== null && rows.length === 0 ? (
        <div className="min-h-0 flex-1 py-10">
          <EmptyState
            icon={Coins}
            title="No workspaces yet"
            body="Nothing has connected a repository or saved a provider."
          />
        </div>
      ) : (
        <EntityList<OperatorCreditsRow>
          variant="embedded"
          label="Workspaces"
          items={rows ?? []}
          itemId={(row) => row.workspaceOrgId}
          activeId={null}
          rowInteractive={() => false}
          loading={rows === null}
          emptyText="No workspaces yet."
          renderRow={(row) => (
            <>
              <span className="flex w-full items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-foreground">
                  {row.workspaceOrgId}
                </span>
                {row.pausedRuns > 0 && (
                  <StatusWord tone="attention" word="Paused" count={row.pausedRuns} />
                )}
                <span className="shrink-0 text-[13px] font-medium tabular-nums text-foreground">
                  {credits(row.balance)}
                </span>
              </span>
              <span className="flex w-full items-center gap-2 text-[11px] text-muted-foreground">
                <span className="min-w-0 truncate tabular-nums">
                  {formatUsd(usdOfCredits(row.balance))} left · {credits(row.spent30d)} spent in 30 days
                  {row.lastGrantAt
                    ? ` · last grant ${credits(row.lastGrantCredits)} on ${startedLabel(row.lastGrantAt)}`
                    : ' · never granted'}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setOpen({ org: row.workspaceOrgId, movement: 'grant' })}
                    className="rounded border border-border px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted/60"
                  >
                    Grant
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen({ org: row.workspaceOrgId, movement: 'adjust' })}
                    className="rounded border border-border px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted/60"
                  >
                    Adjust
                  </button>
                </span>
              </span>
            </>
          )}
        />
      )}
    </div>
  );
}
