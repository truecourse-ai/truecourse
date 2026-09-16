/**
 * Settings › Credits: what this workspace may spend of TrueCourse's own key,
 * and every movement of it.
 *
 * The balance is the one number at the top, said once. Under it whatever is
 * PAUSED — runs that stopped part-way because the money ran out, each with the
 * one thing to do about it — and then the ledger itself, newest first: grants
 * and corrections as themselves, and a run's spending as ONE line for the run,
 * opening the conversation it belongs to.
 *
 * Nothing is composed here: the server folded the debits per run and named
 * every line, so this page draws what it was told.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coins } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CreditEntryView, CreditsResponse, PausedRunView } from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { startedLabel } from '@/components/sessions/run-model';
import { fetchCredits, resumePausedRun } from '@/lib/api';
import { EntityList } from '@/dashboard/ui/entity-list';
import { DISCORD_INVITE_URL } from '@/dashboard/shell/DashboardShell';
import { Facts } from '@/dashboard/ui/bits';
import { StatusWord } from '@/dashboard/ui/status-word';

/** Where a request for more credits goes. */
const CONTACT_EMAIL = 'mushegh@truecourse.dev';

/** What a line of the ledger is called. */
const KIND_WORD: Record<CreditEntryView['kind'], string> = {
  grant: 'Granted',
  debit: 'Spent',
  adjustment: 'Adjusted',
};

/** `1200` → `1,200`. A credit is a whole thing; it never wears a decimal. */
function credits(value: number): string {
  return value.toLocaleString();
}

/** A movement, signed the way a statement reads it. */
function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${credits(value)}`;
}

export function CreditsTab() {
  const navigate = useNavigate();
  const [data, setData] = useState<CreditsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const read = useCallback(() => {
    void fetchCredits()
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(read, [read]);

  const resume = useCallback(
    (jobId: string) => {
      setBusy(jobId);
      setError(null);
      void resumePausedRun(jobId)
        .then(read)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(null));
    },
    [read],
  );

  if (!data) {
    return (
      <div className="px-6 py-5 text-[11px] text-muted-foreground">
        {error ? <span className="text-destructive">Credits could not be read: {error}</span> : 'Reading…'}
      </div>
    );
  }

  const empty = data.entries.length === 0 && data.pausedRuns.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Facts
        className="border-b border-border"
        rowClassName="px-6"
        rows={[
          {
            label: 'Balance',
            value: (
              <span className="tabular-nums">
                <span className="text-lg font-semibold">{credits(data.balance)}</span>
                <span className="ml-2 text-[11px] text-muted-foreground">credits</span>
              </span>
            ),
          },
          {
            label: 'Last grant',
            value: data.lastGrantAt
              ? `${credits(data.lastGrantCredits)} on ${startedLabel(data.lastGrantAt)}`
              : 'none yet',
          },
          {
            label: 'Running on',
            value: data.onCredits ? 'TrueCourse credits' : "this workspace's own provider key",
          },
        ]}
      />

      <div
        role="group"
        aria-label="Credits actions"
        className="flex items-center gap-2 border-b border-border px-6 py-2"
      >
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noreferrer"
          className="rounded border border-border px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted/60"
        >
          Request credits
        </a>
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="rounded border border-border px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted/60"
        >
          Email
        </a>
        <Link
          to="/settings/usage"
          className="ml-auto rounded border border-border px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted/60"
        >
          Usage
        </Link>
      </div>

      {error && (
        <p className="border-b border-border px-6 py-3 text-[11px] text-destructive">{error}</p>
      )}

      {data.pausedRuns.length > 0 && (
        <EntityList<PausedRunView>
          variant="embedded"
          label="Paused runs"
          items={data.pausedRuns}
          itemId={(row) => row.jobId}
          activeId={null}
          rowInteractive={() => false}
          renderRow={(row) => (
            <>
              <span className="flex w-full items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                  {row.title}
                  {row.repository && (
                    <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">
                      {row.repository}
                    </span>
                  )}
                </span>
                <StatusWord tone="attention" word="Paused" />
              </span>
              <span className="flex w-full items-center gap-2 text-[11px] text-muted-foreground">
                <button
                  type="button"
                  disabled={busy === row.jobId || data.balance <= 0}
                  onClick={() => resume(row.jobId)}
                  className="rounded border border-border px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted/60 disabled:opacity-50"
                >
                  {busy === row.jobId ? 'Resuming…' : 'Resume'}
                </button>
                <span className="ml-auto shrink-0 tabular-nums">{startedLabel(row.pausedAt)}</span>
              </span>
            </>
          )}
        />
      )}

      {empty ? (
        <div className="min-h-0 flex-1 py-10">
          <EmptyState
            icon={Coins}
            title="No credits yet"
            body="Nothing has been granted to this workspace and nothing has been spent."
          />
        </div>
      ) : (
        <EntityList<CreditEntryView>
          variant="embedded"
          label="Ledger"
          items={data.entries}
          itemId={(row) => row.id}
          activeId={null}
          rowInteractive={(row) => Boolean(row.runId)}
          onOpen={(id) => {
            const row = data.entries.find((candidate) => candidate.id === id);
            if (row?.runId) navigate(`/agent/${encodeURIComponent(row.runId)}`);
          }}
          emptyText="Nothing has moved yet."
          renderRow={(row) => (
            <>
              <span className="flex w-full items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                  {row.title ?? KIND_WORD[row.kind]}
                  {row.repository && (
                    <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">
                      {row.repository}
                    </span>
                  )}
                </span>
                <span
                  className={`shrink-0 text-[13px] font-medium tabular-nums ${
                    row.amount < 0 ? 'text-muted-foreground' : 'text-foreground'
                  }`}
                >
                  {signed(row.amount)}
                </span>
              </span>
              <span className="flex w-full items-center gap-2 text-[11px] text-muted-foreground">
                <span className="min-w-0 truncate">
                  {row.kind === 'debit'
                    ? `${KIND_WORD.debit} · balance ${credits(row.balanceAfter)}`
                    : [
                        KIND_WORD[row.kind],
                        row.actorUserId ? `by ${row.actorUserId}` : null,
                        row.note,
                        `balance ${credits(row.balanceAfter)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                </span>
                <span className="ml-auto shrink-0 tabular-nums">{startedLabel(row.at)}</span>
              </span>
            </>
          )}
        />
      )}
    </div>
  );
}
