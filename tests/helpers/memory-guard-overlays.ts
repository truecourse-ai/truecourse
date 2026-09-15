/**
 * The supplied-dependency OVERLAYS, in memory — the `GuardOverlayStore` a route
 * test needs without the encrypted Postgres row.
 *
 * Every guard read that composes a scratch tree (`withGuardReadTree`)
 * materializes the repository's overlays into it, so a route test that touches
 * any of those surfaces needs this installed even when it registers nothing.
 */

import {
  setGuardOverlayStore as setByPackage,
  resetGuardOverlayStore as resetByPackage,
  type GuardOverlays,
  type GuardOverlayStore,
} from '@truecourse/core/lib/guard-overlays';
import {
  setGuardOverlayStore as setBySource,
  resetGuardOverlayStore as resetBySource,
} from '../../packages/core/src/lib/guard-overlays';

export class MemoryGuardOverlayStore implements GuardOverlayStore {
  private readonly rows = new Map<string, GuardOverlays>();

  async read(repoKey: string): Promise<GuardOverlays | null> {
    return this.rows.get(repoKey) ?? null;
  }

  async write(repoKey: string, overlays: GuardOverlays): Promise<void> {
    this.rows.set(repoKey, overlays);
  }
}

/**
 * Install the in-memory overlay store for a suite. Pair with
 * {@link resetGuardOverlayStore}.
 *
 * The seam is set through BOTH specifiers a test can reach core by — the package
 * (`@truecourse/core/lib/guard-overlays`, which resolves to the built `dist`) and
 * the source path — because under vitest those are separate module instances
 * with separate seam state.
 */
export function installMemoryGuardOverlays(): MemoryGuardOverlayStore {
  const store = new MemoryGuardOverlayStore();
  setByPackage(store);
  setBySource(store);
  return store;
}

export function resetGuardOverlayStore(): void {
  resetByPackage();
  resetBySource();
}
