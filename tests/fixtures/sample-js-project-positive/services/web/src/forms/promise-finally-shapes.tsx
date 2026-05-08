/**
 * unhandled-promise shape that should NOT fire:
 *
 * Promise chains terminated with .finally() (often after a
 * .then() with the success path inside). The .finally() arm
 * is the cleanup; the chain is "handled" even without an
 * explicit .catch — uncaught rejection still surfaces as
 * unhandledrejection on the global, but the developer has
 * acknowledged completion via .finally.
 */

import { useState } from "react";

declare const apiCall: () => Promise<{ ok: boolean }>;
declare const recordSuccess: (r: { ok: boolean }) => void;

export function FinallyChain(): JSX.Element {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        setBusy(true);
        apiCall()
          .then((r) => recordSuccess(r))
          .finally(() => setBusy(false));
      }}
    >
      {busy ? "Working" : "Run"}
    </button>
  );
}
