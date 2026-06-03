/**
 * Content-addressed Postgres + Blob implementation of core's `ContractStore`.
 * Each unique `.tc` file content is one immutable blob object keyed by its
 * sha256 (deduped per repo+kind — an unchanged contract across commits is stored
 * once); a per-set MANIFEST (`{relPath: sha}`) lives as a jsonb row in
 * `contract_sets`, keyed by `(repo, commit, kind)`. `loadContracts` materializes
 * a set back into a temp dir the unchanged verifier/infer can read.
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { and, desc, eq } from 'drizzle-orm';
import { contractSets, type EeDb } from '@truecourse/ee-db';
import type { BlobStore } from '@truecourse/ee-storage';
import type {
  ContractKind,
  ContractStore,
  MaterializedDir,
  RepoRef,
  SaveContractsResult,
} from '@truecourse/core/lib/contract-store';
import { contractObjectKey } from './keys.js';
import { assertSafeRel, mapLimit, safeJoin, sha256, sortKeys, walkTcRelFiles } from './pack.js';

const OBJECT_CONCURRENCY = 16;

interface Manifest {
  v: number;
  files: Record<string, string>;
}

export class PgBlobContractStore implements ContractStore {
  readonly materializesInPlace = false;
  /** Per-instance memo of objects known to exist, to skip redundant `exists` probes. */
  private readonly known = new Set<string>();

  constructor(
    private readonly db: EeDb,
    private readonly blob: BlobStore,
  ) {}

  async saveContracts(
    ref: RepoRef,
    kind: ContractKind,
    sourceDir: string,
  ): Promise<SaveContractsResult> {
    this.assertCommit(ref);
    const files = walkTcRelFiles(sourceDir, kind);

    // Phase 1: hash every file, build the manifest, and collect the UNIQUE
    // contents. Deduping by sha within the corpus first means two files with
    // identical bytes map to one object — so `objectsWritten` counts real puts
    // and we never issue a redundant put for the same content in one save.
    const manifest: Record<string, string> = {};
    const uniqueBytes = new Map<string, Buffer>();
    await mapLimit(files, OBJECT_CONCURRENCY, async (rel) => {
      assertSafeRel(rel);
      const bytes = await fsp.readFile(path.join(sourceDir, rel));
      const sha = sha256(bytes);
      manifest[rel] = sha;
      if (!uniqueBytes.has(sha)) uniqueBytes.set(sha, bytes);
    });

    // Phase 2: put each unique object (objects first, manifest row last — a
    // crash mid-save can orphan objects, which GC reclaims, but never leaves a
    // manifest pointing at a missing object). Each sha appears once here, so the
    // per-key check-then-act can't race itself within a save.
    let objectsWritten = 0;
    await mapLimit([...uniqueBytes.keys()], OBJECT_CONCURRENCY, async (sha) => {
      const key = contractObjectKey(ref.repoKey, kind, sha);
      if (this.known.has(key)) return;
      if (await this.blob.exists(key)) {
        this.known.add(key);
        return;
      }
      await this.blob.put(key, uniqueBytes.get(sha)!, { contentType: 'text/plain' });
      this.known.add(key);
      objectsWritten += 1;
    });

    const sortedFiles = sortKeys(manifest);
    const manifestHash = sha256(Buffer.from(JSON.stringify(sortedFiles)));
    const payload: Manifest = { v: 1, files: sortedFiles };
    const now = new Date().toISOString();
    await this.db
      .insert(contractSets)
      .values({
        repoKey: ref.repoKey,
        commitSha: ref.commitSha,
        kind,
        manifest: payload,
        manifestHash,
        fileCount: files.length,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [contractSets.repoKey, contractSets.commitSha, contractSets.kind],
        set: { manifest: payload, manifestHash, fileCount: files.length, updatedAt: now },
      });

    return { manifest: sortedFiles, fileCount: files.length, objectsWritten, manifestHash };
  }

  async loadContracts(ref: RepoRef, kind: ContractKind): Promise<MaterializedDir | null> {
    const row = await this.row(ref, kind);
    if (!row) return null;
    const files = (row.manifest as Manifest).files ?? {};

    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `tc-${kind}-`));
    let ok = false;
    try {
      await mapLimit(Object.entries(files), OBJECT_CONCURRENCY, async ([rel, sha]) => {
        const dest = safeJoin(dir, rel);
        const bytes = await this.blob.get(contractObjectKey(ref.repoKey, kind, sha));
        if (!bytes) {
          throw new Error(`[ee-data-store] missing object ${sha} for ${rel} (${ref.repoKey}@${ref.commitSha})`);
        }
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, bytes);
      });
      ok = true;
      return {
        dir,
        cleanup: async () => {
          await fsp.rm(dir, { recursive: true, force: true });
        },
      };
    } finally {
      if (!ok) await fsp.rm(dir, { recursive: true, force: true });
    }
  }

  async hasContracts(ref: RepoRef, kind: ContractKind): Promise<boolean> {
    return (await this.row(ref, kind)) !== null;
  }

  async listContractFiles(repoKey: string, kind: ContractKind): Promise<string[]> {
    const manifest = await this.latestManifest(repoKey, kind);
    return manifest ? Object.keys(manifest.files ?? {}) : [];
  }

  async readContractFile(
    repoKey: string,
    kind: ContractKind,
    relPath: string,
  ): Promise<string | null> {
    const manifest = await this.latestManifest(repoKey, kind);
    const sha = manifest?.files?.[relPath]; // unknown/traversal path ⇒ no sha ⇒ null (no blob read)
    if (!sha) return null;
    const bytes = await this.blob.get(contractObjectKey(repoKey, kind, sha));
    return bytes ? bytes.toString('utf-8') : null;
  }

  /** Manifest of the most-recently-stored set for `(repoKey, kind)` — the "current" set to browse. */
  private async latestManifest(repoKey: string, kind: ContractKind): Promise<Manifest | null> {
    const rows = await this.db
      .select({ manifest: contractSets.manifest })
      .from(contractSets)
      .where(and(eq(contractSets.repoKey, repoKey), eq(contractSets.kind, kind)))
      .orderBy(desc(contractSets.createdAt))
      .limit(1);
    return rows[0] ? (rows[0].manifest as Manifest) : null;
  }

  private async row(
    ref: RepoRef,
    kind: ContractKind,
  ): Promise<{ manifest: unknown } | null> {
    const rows = await this.db
      .select({ manifest: contractSets.manifest })
      .from(contractSets)
      .where(
        and(
          eq(contractSets.repoKey, ref.repoKey),
          eq(contractSets.commitSha, ref.commitSha),
          eq(contractSets.kind, kind),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private assertCommit(ref: RepoRef): void {
    if (!ref.commitSha) {
      throw new Error('[ee-data-store] saveContracts requires a non-empty commit SHA');
    }
  }
}
