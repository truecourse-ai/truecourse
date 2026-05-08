/**
 * raw-error-in-response shape that should NOT fire:
 *
 * `err.message` set into a React state setter (`setTokenError`)
 * is for client-side display, not sent in the HTTP response. The
 * rule's intent is "error details leaked over the wire" — local
 * UI state is the opposite.
 */

import { useState } from "react";

declare const exchangeToken: (code: string) => Promise<string>;

export function TokenExchange(): JSX.Element {
  const [tokenError, setTokenError] = useState<string | null>(null);

  const onSubmit = async (code: string): Promise<void> => {
    try {
      await exchangeToken(code);
    } catch (err: unknown) {
      setTokenError(err instanceof Error ? err.message : "unknown");
    }
  };

  return <button type="button" onClick={() => onSubmit("c")}>{tokenError ?? "Exchange"}</button>;
}
