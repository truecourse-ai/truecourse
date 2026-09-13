/**
 * Pull requests: the gate's list of this repository's pull requests, each with
 * the check it last got, newest first. The sibling of Runs, and the same table
 * idiom: a search over the one thing a pull request is found by, columns for the
 * facts, the verdict as a status word, and the tally at the bottom.
 *
 * A row is one PULL REQUEST, not one run: the gate writes a run per pushed head,
 * and the newest of them is the check that stands. Open and Closed are the two
 * readings, Open first, because a closed pull request is history.
 *
 * The row opens the pull request where it lives, on the provider. The runs
 * behind it are the repository's Runs tab, which already carries a pull request
 * of its own.
 */

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { CHIP_CLASS, PageHeader } from '@/preview/ui/bits';
import { StatusTally, StatusWord, tallyOf, type StatusTone } from '@/preview/ui/status-word';
import { formatGuardTime } from '@/lib/guard-drifts';
import {
  fetchPullRequests,
  isOpenPullRequest,
  type PullRequestRow,
} from '@/preview/data/pull-requests';
import type { Repo } from '@/preview/data/types';

/** The check a pull request got, bad news first: the order rows and tally read in. */
const CONCLUSIONS = ['failure', 'success', 'neutral'] as const;

const CONCLUSION_META: Record<(typeof CONCLUSIONS)[number], { word: string; tone: StatusTone }> = {
  failure: { word: 'Blocked', tone: 'failure' },
  success: { word: 'Passed', tone: 'success' },
  neutral: { word: 'Neutral', tone: 'neutral' },
};

/** The search, over the two things a pull request is found by. */
function matchesQuery(row: PullRequestRow, q: string): boolean {
  return (
    q === '' ||
    `#${row.prNumber}`.includes(q) ||
    (row.title ?? '').toLowerCase().includes(q)
  );
}

export function PullsTab({ repo }: { repo: Repo }) {
  const [rows, setRows] = useState<PullRequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<'open' | 'closed'>('open');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    fetchPullRequests(repo.fullName)
      .then((pulls) => live && setRows(pulls))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [repo.fullName]);

  const { open, closed } = useMemo(() => {
    const o: PullRequestRow[] = [];
    const c: PullRequestRow[] = [];
    for (const row of rows ?? []) (isOpenPullRequest(row.prState) ? o : c).push(row);
    return { open: o, closed: c };
  }, [rows]);

  const inState = state === 'open' ? open : closed;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inState.filter((row) => matchesQuery(row, q));
  }, [inState, query]);

  const tally = useMemo(
    () => tallyOf(visible, CONCLUSIONS, (row) => row.conclusion, (key) => CONCLUSION_META[key]),
    [visible],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Pull requests" />
      <div className="flex min-w-0 shrink-0 items-center gap-3 border-b border-border px-6 py-2">
        <div className="inline-flex shrink-0 rounded border border-border p-0.5 text-[11px]">
          {(['open', 'closed'] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setState(id)}
              aria-pressed={state === id}
              className={`rounded px-2 py-0.5 font-medium capitalize transition-colors ${
                state === id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {id} <span className="tabular-nums">{id === 'open' ? open.length : closed.length}</span>
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search pull requests"
          placeholder="Search pull requests (number, title)"
          className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <table className="w-full min-w-3xl table-fixed border-collapse text-[13px]" aria-label="Pull requests">
          <colgroup>
            <col className="w-24" />
            <col />
            <col className="w-24" />
            <col className="w-24" />
            <col className="w-44" />
            <col className="w-52" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="whitespace-nowrap border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-2 text-left font-semibold">Pull request</th>
              <th className="px-3 py-2 text-left font-semibold">Title</th>
              <th className="px-3 py-2 text-left font-semibold">State</th>
              <th className="px-3 py-2 text-left font-semibold">Head</th>
              <th className="px-3 py-2 text-left font-semibold">Check</th>
              <th className="px-6 py-2 text-left font-semibold">When</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className="border-b border-border/60 transition-colors hover:bg-muted/40">
                <td className="px-6 py-2.5 text-foreground">
                  <a
                    href={`https://github.com/${repo.fullName}/pull/${row.prNumber}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {`#${row.prNumber}`}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </td>
                <td className="px-3 py-2.5 text-foreground">
                  <span className="block truncate" title={row.title ?? ''}>{row.title ?? ''}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className={CHIP_CLASS}>{row.prState ?? 'open'}</span>
                </td>
                <td className="px-3 py-2.5 font-mono text-[12px] text-muted-foreground">
                  <span className="block truncate" title={row.headSha}>{row.headSha.slice(0, 8)}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <StatusWord
                      tone={CONCLUSION_META[row.conclusion].tone}
                      word={CONCLUSION_META[row.conclusion].word}
                    />
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {`+${row.addedCount} / -${row.resolvedCount}`}
                    </span>
                  </span>
                </td>
                <td className="whitespace-nowrap px-6 py-2.5 text-muted-foreground">
                  {formatGuardTime(row.createdAt)}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                  {rows === null && !error
                    ? 'Loading pull requests.'
                    : error
                      ? error
                      : inState.length === 0
                        ? state === 'open'
                          ? 'No open pull request has been checked yet.'
                          : 'No closed pull request yet.'
                        : 'No pull request matches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <StatusTally label="Pull requests" items={tally} total={inState.length} />
    </div>
  );
}
