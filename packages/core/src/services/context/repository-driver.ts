/**
 * The `repository` driver — a repository's own documentation as a workspace
 * source.
 *
 * A sync checks the branch out, walks it with TODAY'S discovery
 * (`discoverDocs`: markdown and OpenAPI, the build/tooling skip list, the
 * `.truecourseignore`, the git last-touched stamp and the content hash), keeps
 * what the source's include patterns select and its exclude patterns do not
 * subtract, and hands every kept file back with its body. Nothing is written
 * into the checkout, and the tree is disposed whatever happens.
 *
 * The scan no longer looks for documents (plan §5): this walk IS the discovery,
 * and what it yields is what the workspace corpus curates.
 *
 * BRANCH. The checkout the provider hands over is the repository's default
 * branch — the branch a push syncs the source on. The source's `branch` records
 * which branch that is, so the header can name it; following another branch is
 * not a choice this slice offers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildSpecScope } from '@truecourse/shared';
import type { ContextSourceCheck, ContextSourceConfig } from '@truecourse/shared';
import { discoverDocs, type DocCandidate } from '@truecourse/spec-consolidator';
import { repositoryConfig } from './config.js';
import { diffAgainstLedger } from './diff.js';
import type {
  ContextDriverDocument,
  ContextDriverOptions,
  ContextSourceDriver,
  ContextSyncResult,
  ContextWorkTreeProvider,
} from './types.js';

/** How many titles a check hands back — enough to recognize the scope. */
const CHECK_TITLE_SAMPLE = 10;

/** An inactive include scope: the walk sees every file and the patterns decide. */
const EVERYTHING = buildSpecScope([]);

export interface RepositoryDriverDeps {
  /** How the driver gets a checkout of the repository. Disposed by the driver. */
  acquireTree: ContextWorkTreeProvider;
}

/**
 * The document's title: its first markdown heading, else the file name without
 * its extension. Never invented — a file with neither is titled by its path.
 */
export function documentTitle(relPath: string, body: string): string {
  const heading = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(body.slice(0, 8_000));
  const title = heading?.[1]?.trim();
  if (title) return title;
  const base = path.posix.basename(relPath);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * The scope filter: a file is in when it matches an include glob and no exclude
 * glob. Both are gitignore-style, built with the same `ignore` engine
 * `.truecourseignore` and `spec.include` use, so one semantics governs all
 * three. An empty include list means everything discovery found.
 */
export function scopeFilter(
  include: readonly string[],
  exclude: readonly string[],
): (relPath: string) => boolean {
  const includes = buildSpecScope([...include]);
  const excludes = buildSpecScope([...exclude]);
  return (relPath) => includes.includes(relPath) && !(excludes.active && excludes.includes(relPath));
}

export function createRepositoryDriver(deps: RepositoryDriverDeps): ContextSourceDriver {
  /**
   * Walk a checkout and keep what the scope selects, in discovery order. The
   * source's own patterns are the whole scope: the repository's `spec.include`
   * does not narrow it, and its registered llms.txt snapshots are not its
   * files (a site is a source of its own).
   */
  function scopedDocs(
    dir: string,
    config: ContextSourceConfig,
    opts: { skipGit: boolean },
  ): DocCandidate[] {
    const { include, exclude } = repositoryConfig(config);
    const keep = scopeFilter(include, exclude);
    return discoverDocs(dir, { skipGit: opts.skipGit, scope: EVERYTHING, registeredSources: false }).filter(
      (doc) => keep(doc.path),
    );
  }

  /** Read the checkout, then always give it back. */
  async function withTree<T>(
    config: ContextSourceConfig,
    fn: (dir: string) => T,
  ): Promise<T> {
    const { repoFullName } = repositoryConfig(config);
    const tree = await deps.acquireTree(repoFullName);
    try {
      return fn(tree.dir);
    } finally {
      await tree.dispose();
    }
  }

  return {
    kind: 'repository',

    async check(config, opts): Promise<ContextSourceCheck> {
      const { repoFullName } = repositoryConfig(config);
      opts?.signal?.throwIfAborted();
      // The git-log lookup per file costs a process each and says nothing a
      // count needs, so a check skips it.
      const docs = await withTree(config, (dir) =>
        scopedDocs(dir, config, { skipGit: true }).map((doc) => ({
          path: doc.path,
          title: documentTitle(doc.path, doc.preview),
        })),
      );
      return {
        title: repoFullName,
        count: docs.length,
        titles: docs.slice(0, CHECK_TITLE_SAMPLE).map((doc) => doc.title),
        skipped: [],
      };
    },

    async sync(config, ledger, opts): Promise<ContextSyncResult> {
      const { repoFullName } = repositoryConfig(config);
      opts?.signal?.throwIfAborted();
      const documents = await withTree(config, (dir) => {
        const candidates = scopedDocs(dir, config, { skipGit: false });
        const out: ContextDriverDocument[] = [];
        candidates.forEach((doc, index) => {
          opts?.signal?.throwIfAborted();
          const body = readBody(doc);
          if (body === null) return;
          out.push({
            docId: doc.path,
            docPath: doc.path,
            title: documentTitle(doc.path, body),
            url: null,
            contentHash: doc.contentHash,
            body,
            updatedAt: doc.lastTouched,
          });
          opts?.onProgress?.(index + 1, candidates.length);
        });
        return out;
      });

      return {
        title: repoFullName,
        documents,
        ...diffAgainstLedger(documents, ledger),
        skipped: [],
      };
    },
  };
}

/** The file's text, or null when it vanished between the walk and the read. */
function readBody(doc: DocCandidate): string | null {
  if (doc.content !== undefined) return doc.content;
  try {
    return fs.readFileSync(doc.absPath, 'utf-8');
  } catch {
    return null;
  }
}
