/**
 * Copy the text and say so for a moment. A clipboard the browser withholds
 * (no permission, an insecure origin) leaves `failed` on the id instead, so
 * the caller can show the text for copying by hand.
 */

import { useState } from 'react';

/** How long a copy is acknowledged, in ms. */
const COPIED_MS = 2000;

export function useCopied() {
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setFailed(id);
      return;
    }
    setFailed(null);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), COPIED_MS);
  };
  return { copied, failed, copy };
}
