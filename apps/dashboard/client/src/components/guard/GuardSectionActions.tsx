/**
 * Capability-gated header actions for the Guard tabs — the single place that
 * decides which Generate/Run affordance (if any) a deployment gets.
 *
 * OSS (`local-filesystem`): the local GuardHeaderActions — Generate, Map and Run
 * spawn guard jobs against the repo's working tree on the server's own disk.
 * Hosted (no `local-filesystem`): those spawns are impossible AND unnecessary —
 * a hosted repo is self-driving. Its scenarios generate automatically off a
 * conflict-free scan (a baseline re-scan chains generation; the last dismissed
 * finding re-generates), and its runs happen on the job queue after generation.
 * So hosted mode shows no manual Generate/Run button. `POST /api/ee/guard/generate`
 * stays for wire-compat but is no longer the primary trigger.
 */

import { useCapability } from '@/contexts/CapabilityContext';
import { GuardHeaderActions } from './GuardHeaderActions';

interface GuardSectionActionsProps {
  kind: 'generate' | 'run' | 'map';
  /** The local (working-tree) trigger — used only under `local-filesystem`. */
  onClick: () => void;
  /** This local action is in flight. */
  busy: boolean;
  /** The other local guard action is in flight. */
  otherBusy: boolean;
  /** Amber-dot staleness signal for the local action. */
  stale?: boolean;
}

export function GuardSectionActions({ kind, onClick, busy, otherBusy, stale }: GuardSectionActionsProps) {
  const hasLocalFilesystem = useCapability('local-filesystem');

  // Only OSS local exposes a manual trigger — the buttons drive the working tree
  // on the server's own disk. Hosted repos self-drive (auto-generate off a
  // conflict-free scan), so they show no button.
  if (!hasLocalFilesystem) return null;

  return (
    <GuardHeaderActions kind={kind} onClick={onClick} busy={busy} otherBusy={otherBusy} stale={stale} />
  );
}
