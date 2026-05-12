/**
 * Decisions tab (BL Drift).
 *
 * Browse and revoke entries in `.truecourse/spec/decisions.json`. For
 * now this is a scaffold — full UI (search, revoke, history) comes
 * in a follow-up. The data is already accessible via
 * `GET /api/repos/:id/spec/decisions`.
 */

import { GitMerge } from 'lucide-react';

export function DecisionsPanel() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
      <GitMerge className="h-8 w-8" />
      <div>
        <h3 className="text-sm font-semibold">Decisions</h3>
        <p className="mt-1 text-xs">
          Your saved conflict resolutions (
          <code className="rounded bg-muted px-1 py-0.5 font-mono">.truecourse/spec/decisions.json</code>
          ) will be browsable here. Coming soon.
        </p>
      </div>
    </div>
  );
}
