/**
 * The Guard "Runs" sub-view — a run inspector, analyze-style: the selected run's
 * summary on the LEFT, its FULL results in the MIDDLE (severity-led non-pass
 * scenarios first, then a collapsible passed group), and — in the RIGHT pane — a
 * preview/pinned TAB STRIP over each opened scenario's run-scoped detail. Selecting
 * a row previews a tab (double-click pins), the same tab model the Scenarios tab
 * uses (`useGuardTabs`, here bound to `?gdrift`). With no tab open the right pane
 * shows the RUN OVERVIEW; closing the last tab returns to it. Switching the
 * selected run keeps the tabs but re-resolves each against the new run — a scenario
 * absent from it shows an honest "not in this run" state. Current state only (no
 * diff mode); no run at all points at `guard run`.
 */

import { useMemo } from 'react';
import { FlaskConical, Loader2, PlayCircle } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useGuardRuns } from '@/hooks/useGuardRuns';
import { useGuardView } from '@/hooks/useGuardView';
import { useGuardTabs } from '@/hooks/useGuardTabs';
import { orderGuardDrifts } from '@/lib/guard-drifts';
import { GuardRunSummary } from './GuardRunSummary';
import { GuardDriftList } from './GuardDriftList';
import { GuardDriftDetail } from './GuardDriftDetail';
import { GuardRunOverview } from './GuardRunOverview';
import { GuardTabStrip } from './GuardTabStrip';

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center">{children}</div>;
}

export function GuardDriftsView({
  repoId,
  enabled = true,
  reloadKey = 0,
}: {
  repoId: string;
  enabled?: boolean;
  /** Bumped on a guard generate/run completion → refetch the run data. */
  reloadKey?: number;
}) {
  const { openSpecSection } = useGuardView();
  const { latest, history, run, selectedRunId, selectRun, loading, error } = useGuardRuns(repoId, enabled, reloadKey);
  const { activeId, openTabs, open, close, selectOverview } = useGuardTabs('gdrift', repoId);

  const drifts = useMemo(() => orderGuardDrifts(run?.scenarios), [run]);
  const passed = useMemo(() => (run?.scenarios ?? []).filter((s) => s.outcome === 'pass'), [run]);
  // The scenarios of the CURRENTLY selected run, indexed for tab re-resolution:
  // a tab kept across a run switch is looked up here against the new run.
  const byId = useMemo(() => new Map((run?.scenarios ?? []).map((s) => [s.id, s])), [run]);
  const activeScenario = activeId ? byId.get(activeId) ?? null : null;

  const tabItems = useMemo(
    () => openTabs.map((t) => ({ ...t, label: t.id, title: byId.get(t.id)?.title ?? t.id })),
    [openTabs, byId],
  );

  if (loading && !run) {
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Centered>
    );
  }
  if (error && !run) {
    return (
      <Centered>
        <p className="max-w-sm px-6 text-center text-sm text-muted-foreground">{error}</p>
      </Centered>
    );
  }
  if (!latest || !run) {
    return (
      <EmptyState
        icon={PlayCircle}
        title="No guard run yet"
        body={
          <>
            Run <code className="rounded bg-muted px-1 py-0.5 text-xs">truecourse guard run</code> to test the
            committed scenarios and surface drift here.
          </>
        }
      />
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* LEFT — run summary + history */}
      <aside className="w-72 shrink-0 overflow-hidden border-r border-border bg-card">
        <GuardRunSummary history={history} selectedRunId={selectedRunId} onSelectRun={selectRun} />
      </aside>

      {/* MIDDLE — full results: severity-led drifts, then the passed group */}
      <div className="w-[360px] shrink-0 overflow-hidden border-r border-border">
        <GuardDriftList
          key={run.run.runId}
          drifts={drifts}
          passed={passed}
          activeId={activeId}
          onPreview={(id) => open(id, false)}
          onPin={(id) => open(id, true)}
        />
      </div>

      {/* RIGHT — tab strip (permanent Overview tab + any open scenarios) over the
          run-scoped detail; the overview shows when no scenario tab is active */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <GuardTabStrip
          tabs={tabItems}
          activeId={activeId}
          onSelect={(t) => open(t.id, t.pinned)}
          onSelectOverview={selectOverview}
          onClose={close}
        />
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {activeScenario ? (
            // Keyed by run + scenario so the evidence/YAML open-state and fetched
            // content reset whenever the shown scenario OR selected run changes.
            <GuardDriftDetail
              key={`${run.run.runId}\0${activeScenario.id}`}
              repoId={repoId}
              scenario={activeScenario}
              runId={run.run.runId}
              onClose={() => close(activeScenario.id)}
              onOpenSpec={openSpecSection}
            />
          ) : activeId ? (
            // A tab kept across a run switch whose scenario the new run doesn't have.
            <EmptyState
              icon={FlaskConical}
              title="Not in this run"
              body={
                <>
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">{activeId}</code> was not part of the
                  selected run.
                </>
              }
            />
          ) : (
            <GuardRunOverview run={run} error={error} />
          )}
        </div>
      </div>
    </div>
  );
}
