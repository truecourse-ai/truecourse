/**
 * misused-promise shape that should NOT fire:
 *
 * Truthy check on a ref that may hold a Promise. The check is
 * "is the ref populated?", not "is the promise resolved?".
 * Wrapping in `await` would change semantics.
 */

import { useRef } from "react";

declare const startSave: () => Promise<void>;

export function isSaving(): boolean {
  const saveRef = useRef<Promise<void> | null>(null);
  return Boolean(saveRef.current);
}

export async function trySave(): Promise<boolean> {
  const saveRef = useRef<Promise<void> | null>(null);
  if (saveRef.current) return false;
  saveRef.current = startSave();
  try {
    await saveRef.current;
  } finally {
    saveRef.current = null;
  }
  return true;
}
