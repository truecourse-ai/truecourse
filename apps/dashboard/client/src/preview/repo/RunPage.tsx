/**
 * One run, as its own page (`/runs/:runId`): the breadcrumb back to Runs, the
 * run's facts on one line, then its results (the list, the tab strip, the
 * opened result's detail), the real run components over the run the address
 * names — the server's snapshot for a connected repository, a fixture's for a
 * mock one.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, Loader2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { CHIP_CLASS, PageHeader } from '@/preview/ui/bits';
import { CollapsibleAside } from '@/preview/ui/collapsible-aside';
import { GuardDriftDetail } from '@/preview/vendor/components/guard/GuardDriftDetail';
import { GuardDriftList } from '@/preview/vendor/components/guard/GuardDriftList';
import { useGuardTabs } from '@/preview/vendor/hooks/useGuardTabs';
import { useGuardView } from '@/preview/vendor/hooks/useGuardView';
import { formatGuardDuration, formatGuardTime, guardRunRef, orderGuardDrifts } from '@/preview/vendor/lib/guard-drifts';
import { guardStatusMeta } from '@/preview/vendor/lib/guard-status';
import { coverageVersionById } from '@/preview/data/corpus';
import type { Repo } from '@/preview/data/types';
import { useGuardTabJump } from './tab-jump';
import { useGuardRun } from './use-guard-run';

export function RunPage({ repo, runId }: { repo: Repo; runId: string }) {
  useGuardTabJump();
  const { openSpecSection, openGuardFlow } = useGuardView();
  const { run: shown, loading, error } = useGuardRun(repo.id, runId);

  const { activeId, open } = useGuardTabs('result', repo.id);
  const drifts = useMemo(() => orderGuardDrifts(shown?.scenarios), [shown]);
  const passed = useMemo(() => (shown?.scenarios ?? []).filter((s) => s.outcome === 'pass'), [shown]);
  const byId = useMemo(() => new Map((shown?.scenarios ?? []).map((s) => [s.id, s])), [shown]);
  const active = activeId ? byId.get(activeId) ?? null : null;

  const env = shown?.run;
  const verdict = shown && (shown.summary.fail > 0 || shown.summary.error > 0) ? 'fail' : 'pass';
  const version = env?.coverageVersion ? coverageVersionById(repo.id, env.coverageVersion) : undefined;
  const totalMs = (shown?.scenarios ?? []).reduce((n, s) => n + s.durationMs, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumbs={[{ label: 'Runs', to: `/preview/repos/${repo.id}/runs` }]}
        title={<span className="font-mono">{env?.commit ?? runId}</span>}
        subtitle={
          env && (
            <span className="flex items-center gap-3">
              <span className="font-mono text-[12px]">{guardRunRef(env)}</span>
              {env.pullRequest != null && <span className={CHIP_CLASS}>#{env.pullRequest}</span>}
              <span className={CHIP_CLASS}>{env.origin ?? 'hosted'}</span>
              {version && (
                <Link
                  to={`/preview/repos/${repo.id}/corpus?version=${encodeURIComponent(version.id)}`}
                  className="text-[11px] hover:text-foreground hover:underline"
                >
                  coverage {version.label} · {version.sha}
                </Link>
              )}
            </span>
          )
        }
        right={
          env && (
            <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span>{formatGuardTime(env.ranAt)}</span>
              <span>{formatGuardDuration(totalMs)}</span>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-foreground">
                <span aria-hidden className={`h-2 w-2 rounded-full ${guardStatusMeta(verdict).dot}`} />
                {verdict === 'fail' ? 'Failed' : 'Passed'}
              </span>
            </span>
          )
        }
      />

      {!shown ? (
        <div className="flex flex-1 items-center justify-center">
          {loading ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : error ? (
            <EmptyState icon={FlaskConical} title="The run could not be read" body={error} />
          ) : (
            <EmptyState icon={FlaskConical} title="No such run" body="Nothing is recorded under that id." />
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <CollapsibleAside label="Results" defaultWidth={360}>
            <GuardDriftList
              key={shown.run.runId}
              drifts={drifts}
              passed={passed}
              activeId={activeId}
              onPreview={(id) => open(id, true)}
              onPin={(id) => open(id, true)}
            />
          </CollapsibleAside>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="relative min-h-0 flex-1 overflow-hidden">
              {active ? (
                <GuardDriftDetail
                  key={`${shown.run.runId} ${active.id}`}
                  repoId={repo.id}
                  scenario={active}
                  runId={shown.run.runId}
                  runFlow={(shown.runFlows ?? []).find((f) => f.flowId === active.flowId) ?? null}
                  onOpenSpec={openSpecSection}
                  onOpenFlow={openGuardFlow}
                />
              ) : (
                <EmptyState icon={FlaskConical} title="Select a result" body="Select a result." />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
