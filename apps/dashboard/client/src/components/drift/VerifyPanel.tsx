/**
 * Verify tab (BL Drift).
 *
 * Runs the verifier against the code and surfaces drift items. For
 * now this is a scaffold — wire to `truecourse verify` output in a
 * follow-up.
 */

import { ShieldCheck } from 'lucide-react';

export function VerifyPanel() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
      <ShieldCheck className="h-8 w-8" />
      <div>
        <h3 className="text-sm font-semibold">Verify</h3>
        <p className="mt-1 text-xs">
          Drift items detected by the verifier will appear here. Coming
          soon — run <code className="rounded bg-muted px-1 py-0.5 font-mono">truecourse verify</code> from the CLI today.
        </p>
      </div>
    </div>
  );
}
