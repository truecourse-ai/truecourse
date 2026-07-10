/**
 * Capability-gated header actions for the Guard tabs — the single place that
 * decides which Generate/Run affordance (if any) a deployment gets.
 *
 * OSS (`local-filesystem`): the local GuardHeaderActions — Generate and Run
 * spawn guard jobs against the repo's working tree on the server's own disk.
 * Hosted (no `local-filesystem`): those spawns are impossible. When the EE
 * guard subsystem is up (the `guard` capability — advertised only while the
 * background job worker runs), Generate instead enqueues the `repo.guard` job
 * over `POST /api/ee/guard/generate`; progress and the result arrive through
 * the SSE-driven jobs popup + notifications feed (the IntegrationsPage sync
 * idiom), so the button owns only the enqueue and its toasts. There is no
 * hosted Run — the run happens on the job queue after generation — and with
 * neither capability the actions degrade to hidden, never broken.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { useCapability } from '@/contexts/CapabilityContext';
import { getServerUrl } from '@/lib/server-url';
import { GuardHeaderActions } from './GuardHeaderActions';

interface GuardSectionActionsProps {
  kind: 'generate' | 'run';
  /** The local (working-tree) trigger — used only under `local-filesystem`. */
  onClick: () => void;
  /** This local action is in flight. */
  busy: boolean;
  /** The other local guard action is in flight. */
  otherBusy: boolean;
  /** Amber-dot staleness signal for the local action. */
  stale?: boolean;
  /** The connected repo's GitHub fullName — required for the hosted Generate. */
  repoFullName?: string;
}

export function GuardSectionActions({
  kind,
  onClick,
  busy,
  otherBusy,
  stale,
  repoFullName,
}: GuardSectionActionsProps) {
  const hasLocalFilesystem = useCapability('local-filesystem');
  const hasHostedGuard = useCapability('guard');

  if (hasLocalFilesystem) {
    return (
      <GuardHeaderActions kind={kind} onClick={onClick} busy={busy} otherBusy={otherBusy} stale={stale} />
    );
  }
  if (kind === 'generate' && hasHostedGuard && repoFullName) {
    return <HostedGuardGenerateButton repoFullName={repoFullName} />;
  }
  // Hosted with the guard subsystem down (or no repo identity yet): hidden.
  return null;
}

/**
 * The hosted Generate: POST the enqueue, then get out of the way — a 202 means
 * the `repo.guard` job is queued and the jobs popup narrates it from here. Any
 * rejection (409 already-running / not-scanned / no-LLM, 404 not connected)
 * surfaces the server's own message.
 */
function HostedGuardGenerateButton({ repoFullName }: { repoFullName: string }) {
  const [submitting, setSubmitting] = useState(false);

  const generate = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${getServerUrl()}/api/ee/guard/generate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoFullName }),
      });
      if (!res.ok) {
        let msg = `Request failed: ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) msg = body.error;
        } catch {
          /* keep status message */
        }
        throw new Error(msg);
      }
      toast.success('Guard generation started', {
        description: 'Progress and the result arrive in the jobs popup.',
      });
    } catch (e) {
      toast.error('Could not start guard generation', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <GuardHeaderActions
      kind="generate"
      onClick={() => void generate()}
      busy={submitting}
      otherBusy={false}
    />
  );
}
