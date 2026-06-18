/**
 * Postgres-backed `InferredActionStore` (the dismiss/promote overlay). Mirrors the
 * core file default; `repoKey` is the gate's `owner/repo` identity. Backed by the
 * `gh_inferred_actions` table.
 */

import { and, eq, sql } from 'drizzle-orm';
import { ghInferredActions, type EeDb } from '@truecourse/ee-db';
import type { InferredActionStore, InferredAction } from '@truecourse/core/lib/inferred-action-store';

export class PgInferredActionStore implements InferredActionStore {
  constructor(private readonly db: EeDb) {}

  async setAction(repoKey: string, action: InferredAction): Promise<void> {
    await this.db
      .insert(ghInferredActions)
      .values({
        repoFullName: repoKey,
        kind: action.kind,
        identity: action.identity,
        status: action.status,
        createdAt: action.createdAt,
      })
      .onConflictDoUpdate({
        target: [
          ghInferredActions.repoFullName,
          ghInferredActions.kind,
          ghInferredActions.identity,
        ],
        set: { status: sql`excluded.status`, createdAt: sql`excluded.created_at` },
      });
  }

  async removeAction(repoKey: string, kind: string, identity: string): Promise<void> {
    await this.db
      .delete(ghInferredActions)
      .where(
        and(
          eq(ghInferredActions.repoFullName, repoKey),
          eq(ghInferredActions.kind, kind),
          eq(ghInferredActions.identity, identity),
        ),
      );
  }

  async listActions(repoKey: string): Promise<InferredAction[]> {
    const rows = await this.db
      .select()
      .from(ghInferredActions)
      .where(eq(ghInferredActions.repoFullName, repoKey));
    return rows.map((r) => ({
      kind: r.kind,
      identity: r.identity,
      status: r.status as InferredAction['status'],
      createdAt: r.createdAt,
    }));
  }
}
