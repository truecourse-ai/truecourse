/**
 * Context's frame: the one-row header ({@link PageHeader}, the platform's), the
 * WORKSPACE's two actions in it, and the side menu of its three sections beside
 * the content.
 *
 * Context is where documentation is sourced, all of it: a source is added here
 * and listed here (the section LANDS on Sources), its documents are curated
 * here, the conflicts between them are settled here, and a repository then
 * LINKS the sources it reads on its own Context tab. The repository console has
 * no corpus of its own any more.
 *
 * Scan and Add context belong to the WORKSPACE rather than to any one section,
 * so the frame owns them and every section carries them: the Document scan
 * starts on Context, on whichever of its pages the reader happens to be. A page
 * contributes only what is its own through `right` — the narrowed Documents
 * view's source status and scope.
 *
 * The pages each hold the context signal already, so it is passed in rather
 * than subscribed to twice.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader, SideMenu } from '@/preview/ui/bits';
import { startContextScan } from '@/preview/data/scan';
import { toastNoLlmProvider } from '@/preview/shell/use-run-trigger';
import { useWorkspaceRuns } from '@/preview/shell/use-workspace-runs';
import { useContextSources, useContextStaleness } from '@/preview/shell/use-context';
import { AddContextDialog } from './AddContextDialog';
import { CONFLICTS_BASE, CONTEXT_BASE, DOCUMENTS_BASE } from './context-hrefs';

export type ContextSection = 'sources' | 'documents' | 'conflicts';

const ACTION =
  'rounded border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 disabled:opacity-50';

/**
 * The workspace Document scan. Amber-dotted while the context has moved since
 * the corpus was built; disabled and saying so while one is running, which is
 * read from the workspace's own runs, not guessed at.
 */
function ScanButton({ stale, scanning }: { stale: boolean; scanning: boolean }) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const running = pending || scanning;

  const start = useCallback(() => {
    if (running) return;
    setPending(true);
    void startContextScan()
      .then((outcome) => {
        switch (outcome.kind) {
          case 'started':
            return;
          case 'not-configured':
            toastNoLlmProvider(navigate, outcome.message);
            return;
          case 'probe-failed':
            toast.error(`Provider check failed: ${outcome.message}`);
            return;
          case 'busy':
            toast.error('A document scan is already running');
            return;
          default:
            toast.error('Could not start the document scan', { description: outcome.message });
        }
      })
      .finally(() => setPending(false));
  }, [navigate, running]);

  return (
    <button type="button" onClick={start} disabled={running} className={`${ACTION} relative`}>
      {running ? 'Scanning…' : 'Scan'}
      {stale && !running && (
        <span
          aria-label="scan pending"
          className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-background"
        />
      )}
    </button>
  );
}

export function ContextFrame({
  section,
  signal,
  crumbs = [],
  right,
  children,
}: {
  section: ContextSection;
  /** The page's context signal, so the frame's reads move with the page's. */
  signal: number;
  /** The trail after "Context", innermost last; the last one is the page's name. */
  crumbs?: { label: string; to?: string }[];
  right?: ReactNode;
  children: ReactNode;
}) {
  const { sources, refetch } = useContextSources(signal);
  const stale = useContextStaleness(signal);
  const { runs } = useWorkspaceRuns([]);
  // Add context opens by address: `?add=repository` is the install's return
  // (the Repository step, with the account just connected), `?add=1` is the
  // plain open at the kind step, which is how Home's checkpoint gets here.
  // Either way the address is cleaned so a reload does not reopen the dialog.
  const [searchParams, setSearchParams] = useSearchParams();
  const asked = searchParams.get('add');
  const [adding, setAdding] = useState(asked === 'repository' || asked === '1');
  const [addKind, setAddKind] = useState<'repository' | null>(
    asked === 'repository' ? 'repository' : null,
  );
  useEffect(() => {
    const value = searchParams.get('add');
    if (value !== 'repository' && value !== '1') return;
    const next = new URLSearchParams(searchParams);
    next.delete('add');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // A Document scan belongs to the workspace, so it is the run with no
  // repository — the one fact that says the button is busy.
  const scanning = (runs ?? []).some(
    (run) => run.repo === null && run.command === 'spec-scan' && run.status === 'running',
  );

  const title = crumbs.length > 0 ? crumbs[crumbs.length - 1]!.label : 'Context';
  const trail = [
    ...(crumbs.length > 0 ? [{ label: 'Context', to: CONTEXT_BASE }] : []),
    ...crumbs.slice(0, -1).map((crumb) => ({ label: crumb.label, to: crumb.to ?? CONTEXT_BASE })),
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={title}
        crumbs={trail}
        right={
          <>
            {right}
            <ScanButton stale={stale} scanning={scanning} />
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Add context
            </button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        <SideMenu
          label="Context sections"
          activeId={section}
          items={[
            { id: 'sources', label: 'Sources', to: CONTEXT_BASE },
            { id: 'documents', label: 'Documents', to: DOCUMENTS_BASE },
            { id: 'conflicts', label: 'Conflicts', to: CONFLICTS_BASE },
          ]}
        />
        <div className="min-h-0 min-w-0 flex-1">{children}</div>
      </div>
      <AddContextDialog
        open={adding}
        onOpenChange={(open) => {
          setAdding(open);
          if (!open) setAddKind(null);
        }}
        initialKind={addKind}
        sources={sources}
        onAdded={() => void refetch()}
      />
    </div>
  );
}
