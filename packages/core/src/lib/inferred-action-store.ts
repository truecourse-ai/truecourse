/**
 * Persistent per-repo overlay of user actions on inferred decisions (dismiss /
 * promote), keyed by `repoKey` + `(kind, identity)`. The dashboard and the gate
 * apply it so a dismissed/promoted decision stays actioned across re-inference
 * (which re-derives the set from scratch).
 *
 * File-backed by default (OSS — JSON under `<repo>/.truecourse/specs/`); the
 * enterprise edition injects a Postgres-backed impl via `setInferredActionStore`,
 * exactly like the contract / spec / analysis stores. Shared logic, swappable
 * transport.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface InferredAction {
  kind: string;
  identity: string;
  status: 'dismissed' | 'promoted';
  createdAt: string;
}

export interface InferredActionStore {
  /** Record/replace the action on one decision. */
  setAction(repoKey: string, action: InferredAction): Promise<void>;
  /** Undo an action (e.g. un-dismiss). No-op when absent. */
  removeAction(repoKey: string, kind: string, identity: string): Promise<void>;
  /** Every recorded action for a repo. */
  listActions(repoKey: string): Promise<InferredAction[]>;
}

function actionsFile(repoKey: string): string {
  return path.join(repoKey, '.truecourse', 'specs', 'inferred-actions.json');
}

/** File-backed default (OSS): one JSON array per repo at the path above. */
class FileInferredActionStore implements InferredActionStore {
  private read(repoKey: string): InferredAction[] {
    try {
      return JSON.parse(fs.readFileSync(actionsFile(repoKey), 'utf-8')) as InferredAction[];
    } catch {
      return [];
    }
  }

  private write(repoKey: string, actions: InferredAction[]): void {
    const file = actionsFile(repoKey);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(actions, null, 2) + '\n', 'utf-8');
  }

  async setAction(repoKey: string, action: InferredAction): Promise<void> {
    const next = this.read(repoKey).filter(
      (a) => !(a.kind === action.kind && a.identity === action.identity),
    );
    next.push(action);
    this.write(repoKey, next);
  }

  async removeAction(repoKey: string, kind: string, identity: string): Promise<void> {
    this.write(
      repoKey,
      this.read(repoKey).filter((a) => !(a.kind === kind && a.identity === identity)),
    );
  }

  async listActions(repoKey: string): Promise<InferredAction[]> {
    return this.read(repoKey);
  }
}

let active: InferredActionStore = new FileInferredActionStore();

export function setInferredActionStore(store: InferredActionStore): void {
  active = store;
}
export function resetInferredActionStore(): void {
  active = new FileInferredActionStore();
}

export const setInferredAction = (repoKey: string, action: InferredAction): Promise<void> =>
  active.setAction(repoKey, action);
export const removeInferredAction = (
  repoKey: string,
  kind: string,
  identity: string,
): Promise<void> => active.removeAction(repoKey, kind, identity);
export const listInferredActions = (repoKey: string): Promise<InferredAction[]> =>
  active.listActions(repoKey);
