/**
 * Content-addressed store over the `content` table — the single dedup pool for
 * immutable bodies in the hosted edition: contract `.tc` files, immutable spec
 * artifacts (corpus, decisions), and LLM trace payloads. One row per
 * (scope, sha): identical content under a scope is written once; manifests / refs
 * elsewhere point in by sha.
 *
 * `scope` is the dedup + tenant-isolation namespace. We prefix by data TYPE so
 * each type's GC stays independent (`contract:`, `spec:`, `trace:`), and by the
 * owning key (a repo key, or `ws:<org>` for workspace-shared, or an org for
 * traces). There is no cross-scope dedup.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { content, type EeDb } from '@truecourse/ee-db';
import { sha256 } from './pack.js';

/** Scope builders — keep the namespacing in one place. */
export const contentScope = {
  contract: (repoKey: string): string => `contract:${repoKey}`,
  workspaceContract: (org: string): string => `contract:ws:${org}`,
  spec: (repoKey: string): string => `spec:${repoKey}`,
  workspaceSpec: (org: string): string => `spec:ws:${org}`,
  trace: (org: string): string => `trace:${org}`,
};

export class ContentStore {
  constructor(private readonly db: EeDb) {}

  /** Hash + store `body` under `scope`; returns its sha. Idempotent (dedup). */
  async putText(scope: string, body: string): Promise<string> {
    const sha = sha256(Buffer.from(body, 'utf-8'));
    await this.put(scope, sha, body);
    return sha;
  }

  /**
   * Store a pre-hashed body. Idempotent via the table's unique (scope, sha)
   * constraint; returns true iff a NEW row was written (for counts). Deliberately
   * keeps NO in-memory "already written" memo: such a memo desyncs when content is
   * deleted out-of-band and makes `put` skip a write whose row is gone, leaving a
   * manifest pointing at a missing object. The on-conflict insert is a no-op for
   * existing rows, so always issuing it is the right trade.
   */
  async put(scope: string, sha: string, body: string): Promise<boolean> {
    const inserted = await this.db
      .insert(content)
      .values({ scope, sha, body, createdAt: new Date().toISOString() })
      .onConflictDoNothing({ target: [content.scope, content.sha] })
      .returning({ sha: content.sha });
    return inserted.length > 0;
  }

  async get(scope: string, sha: string): Promise<string | null> {
    const rows = await this.db
      .select({ body: content.body })
      .from(content)
      .where(and(eq(content.scope, scope), eq(content.sha, sha)))
      .limit(1);
    return rows[0]?.body ?? null;
  }

  async getJson<T>(scope: string, sha: string): Promise<T | null> {
    const body = await this.get(scope, sha);
    return body == null ? null : (JSON.parse(body) as T);
  }

  /** Sweep: delete `scope` bodies whose sha is not in `liveShas`. Returns count. */
  async gc(scope: string, liveShas: Set<string>): Promise<number> {
    const rows = await this.db
      .select({ sha: content.sha })
      .from(content)
      .where(eq(content.scope, scope));
    const dead = rows.map((r) => r.sha).filter((s) => !liveShas.has(s));
    if (dead.length === 0) return 0;
    await this.db
      .delete(content)
      .where(and(eq(content.scope, scope), inArray(content.sha, dead)));
    return dead.length;
  }
}
