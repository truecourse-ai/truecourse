/**
 * Catch blocks where the error variable is NEVER referenced in
 * the catch body — generic "show toast on any error" patterns.
 * No type-safety risk; flagging them as untyped catch variables
 * adds noise.
 *
 * Positive fixture: NO unknown-catch-variable violations should
 * fire on this file.
 */

declare const toast: (opts: { title: string }) => void;

export async function deleteAccount(): Promise<void> {
  try {
    await fetch("/api/account", { method: "DELETE" });
  } catch (err) {
    // err NEVER referenced — generic error path
    toast({ title: "Account deletion failed" });
  }
}

export async function syncSettings(): Promise<void> {
  try {
    await fetch("/api/settings");
  } catch (error) {
    toast({ title: "Sync failed" });
  }
}

export async function reload(): Promise<void> {
  try {
    await fetch("/api/state");
  } catch (e) {
    toast({ title: "Reload failed" });
  }
}
