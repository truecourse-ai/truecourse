/**
 * Content-addressed store over the `content` table — the single dedup pool for
 * immutable bodies: the workspace's spec artifacts and documents, and a
 * repository's guard tree and evidence. One row per (scope, sha): identical
 * content under a scope is written once; manifests / refs elsewhere point in by
 * sha.
 *
 * `scope` is the dedup + tenant-isolation namespace. We prefix by data TYPE so
 * each type's GC stays independent (`spec:`, `guard:`), and by the owning key
 * (a repo key, or `ws:<org>` for workspace-shared). There is no cross-scope
 * dedup.
 */

import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { content, type Db } from '@truecourse/db';
import { sha256 } from './pack.js';

/** Scope builders — keep the namespacing in one place. */
export const contentScope = {
  workspaceSpec: (org: string): string => `spec:ws:${org}`,
  /** Document bodies of the workspace's Context sources (sha = `sha256-<ledger contentHash>`). */
  context: (org: string): string => `context:ws:${org}`,
  trace: (org: string): string => `trace:${org}`,
  /** Guard scenario-tree bodies (yaml / recipe.json / manifest.json). */
  guard: (repoKey: string): string => `guard:${repoKey}`,
  /** Per-run guard evidence — transcripts as text, a browser run's screenshots and video as bytes. */
  guardEvidence: (repoKey: string): string => `guard-evidence:${repoKey}`,
};

export class ContentStore {
  constructor(private readonly db: Db) {}

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
   * manifest pointing at a missing object, so the insert is always issued.
   *
   * A body already in the pool gets its `created_at` moved to now: the sweep's
   * grace period (`gc`'s `before`) protects a body by that stamp, and a save
   * that re-references a body nothing referenced any more would otherwise put
   * it, then lose it to a concurrent sweep before its manifest row landed.
   */
  async put(scope: string, sha: string, body: string): Promise<boolean> {
    const rows = await this.db
      .insert(content)
      .values({ scope, sha, body, createdAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: [content.scope, content.sha],
        set: { createdAt: sql`excluded.created_at` },
      })
      // A row an INSERT created has no updating transaction id; an updated one does.
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    return rows[0]?.inserted === true;
  }

  /**
   * Hash + store raw BYTES under `scope`; returns the sha of the bytes. The body
   * column is text, so the bytes travel base64-encoded — `getBytes` is the only
   * reader that knows, and a text `get` of such a row is a caller's mistake.
   */
  async putBytes(scope: string, bytes: Buffer): Promise<string> {
    const sha = sha256(bytes);
    await this.put(scope, sha, bytes.toString('base64'));
    return sha;
  }

  /** The bytes `putBytes` stored, or null. */
  async getBytes(scope: string, sha: string): Promise<Buffer | null> {
    const body = await this.get(scope, sha);
    return body == null ? null : Buffer.from(body, 'base64');
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

  /**
   * Sweep: delete `scope` bodies whose sha is not in `liveShas`. With `before`,
   * only bodies stored (or last re-put, see `put`) before that moment are
   * candidates — a save puts its bodies before the row that references them,
   * and a sweep must not take a body whose row is still on its way. Returns
   * the count deleted.
   */
  async gc(scope: string, liveShas: Set<string>, before?: string): Promise<number> {
    const rows = await this.db
      .select({ sha: content.sha })
      .from(content)
      .where(
        before
          ? and(eq(content.scope, scope), lt(content.createdAt, before))
          : eq(content.scope, scope),
      );
    const dead = rows.map((r) => r.sha).filter((s) => !liveShas.has(s));
    if (dead.length === 0) return 0;
    await this.db
      .delete(content)
      .where(and(eq(content.scope, scope), inArray(content.sha, dead)));
    return dead.length;
  }
}
