/**
 * The web SPEC SOURCES — the llms.txt documentation sites a repository
 * registers (`truecourse spec source`), each a registry entry plus the
 * markdown pages it snapshotted.
 *
 * In a working tree they are `.truecourse/specs/sources.json` and the files
 * under `.truecourse/specs/sources/<id>/`, and the engine that adds, refreshes
 * and removes a source works on those files. A hosted repository has no working
 * tree, so the same state lives in the store as ONE registry per repo plus the
 * page bodies, keyed by the content hash the registry already carries — and is
 * MATERIALIZED into a tree whenever the engine needs one: the scan's clone, so
 * discovery reads the pages like any repo doc, and a scratch tree for the
 * dashboard's add / refresh / remove, whose result is collected back.
 *
 * One seam, two implementations: the file store IS the tree (the default — a
 * CLI checkout reads and writes it in place); the hosted store is the row
 * (`@truecourse/data-store`), installed at boot.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readSourcesFile,
  sourceDirPath,
  sourceDocAbsPath,
  sourcesFilePath,
  writeSourcesFile,
  SOURCES_REF_PREFIX,
  type SourcesFile,
} from '@truecourse/spec-consolidator';

/** The registry with every page body it names, by the page's content hash. */
export interface SpecSourcesSnapshot {
  registry: SourcesFile;
  /** `contentHash → markdown`. A hash the registry names but the tree lacks is absent. */
  bodies: Record<string, string>;
}

/** Pluggable sources store. The file store is the default; the hosted store is a row. */
export interface SpecSourcesStore {
  /** The registry. Empty when nothing is registered — never null, so callers list. */
  readRegistry(repoKey: string): Promise<SourcesFile>;
  /** One page's markdown by its content hash, or null when the store lacks it. */
  readBody(repoKey: string, contentHash: string): Promise<string | null>;
  /** Replace the stored sources. An empty registry clears the store. */
  write(repoKey: string, snapshot: SpecSourcesSnapshot): Promise<void>;
  /**
   * When the sources last changed (an add, a refresh, a remove), as an ISO
   * stamp, or null when nothing is registered. Compared against the corpus's
   * own timestamp, it says whether a scan has seen the current sources.
   */
  changedAt(repoKey: string): Promise<string | null>;
  /** `true` when the repo key is a working tree the engine edits in place (file store). */
  readonly materializesInPlace: boolean;
}

/**
 * Read the registry and every page it names out of a working tree. A missing
 * registry reads as empty; a corrupt one throws, as the engine's own reader does
 * — storing an empty snapshot over it would orphan every page it still names.
 */
export function readSpecSourcesFromTree(treeDir: string): SpecSourcesSnapshot {
  const registry = readSourcesFile(treeDir);
  const bodies: Record<string, string> = {};
  for (const source of registry.sources) {
    const dir = sourceDirPath(treeDir, source.id);
    for (const doc of source.docs) {
      const abs = sourceDocAbsPath(dir, doc.path);
      if (!abs || !fs.existsSync(abs)) continue;
      bodies[doc.contentHash] = fs.readFileSync(abs, 'utf-8');
    }
  }
  return { registry, bodies };
}

/**
 * Write the registry and its pages into a working tree, exactly where the
 * engine reads them. A page whose body the store lacks is left unwritten: the
 * registry still names it, and discovery skips a file that is not there.
 */
export function writeSpecSourcesToTree(treeDir: string, snapshot: SpecSourcesSnapshot): void {
  if (snapshot.registry.sources.length === 0) return;
  writeSourcesFile(treeDir, snapshot.registry);
  for (const source of snapshot.registry.sources) {
    const dir = sourceDirPath(treeDir, source.id);
    for (const doc of source.docs) {
      const body = snapshot.bodies[doc.contentHash];
      const abs = sourceDocAbsPath(dir, doc.path);
      if (body == null || !abs) continue;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body, 'utf-8');
    }
  }
}

/** `<prefix>/<sourceId>/<page path>` → its parts, or null for a ref that is not a source page. */
export function parseSpecSourceRef(ref: string): { sourceId: string; docPath: string } | null {
  if (!ref.startsWith(`${SOURCES_REF_PREFIX}/`)) return null;
  const rest = ref.slice(SOURCES_REF_PREFIX.length + 1);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { sourceId: rest.slice(0, slash), docPath: rest.slice(slash + 1) };
}

/** The default: the repo key is a working tree and the sources are its files. */
class FileSpecSourcesStore implements SpecSourcesStore {
  readonly materializesInPlace = true;

  async readRegistry(repoRoot: string): Promise<SourcesFile> {
    return readSourcesFile(repoRoot);
  }

  async readBody(repoRoot: string, contentHash: string): Promise<string | null> {
    for (const source of readSourcesFile(repoRoot).sources) {
      const doc = source.docs.find((d) => d.contentHash === contentHash);
      if (!doc) continue;
      const abs = sourceDocAbsPath(sourceDirPath(repoRoot, source.id), doc.path);
      if (abs && fs.existsSync(abs)) return fs.readFileSync(abs, 'utf-8');
    }
    return null;
  }

  async write(repoRoot: string, snapshot: SpecSourcesSnapshot): Promise<void> {
    writeSpecSourcesToTree(repoRoot, snapshot);
  }

  // The registry is rewritten by every add, refresh and remove, so its mtime
  // is when the sources last changed.
  async changedAt(repoRoot: string): Promise<string | null> {
    const file = sourcesFilePath(repoRoot);
    return fs.existsSync(file) ? fs.statSync(file).mtime.toISOString() : null;
  }
}

const fileStore = new FileSpecSourcesStore();
let active: SpecSourcesStore = fileStore;

export function setSpecSourcesStore(store: SpecSourcesStore): void {
  active = store;
}

export function resetSpecSourcesStore(): void {
  active = fileStore;
}

/** Whether the active store edits the repo's own tree (file) or holds a row (hosted). */
export const specSourcesMaterializeInPlace = (): boolean => active.materializesInPlace;

export const readSpecSourcesRegistry = (repoKey: string): Promise<SourcesFile> =>
  active.readRegistry(repoKey);

export const writeSpecSources = (repoKey: string, snapshot: SpecSourcesSnapshot): Promise<void> =>
  active.write(repoKey, snapshot);

export const specSourcesChangedAt = (repoKey: string): Promise<string | null> =>
  active.changedAt(repoKey);

/**
 * One snapshotted page's markdown by its corpus ref, or null when the ref is
 * not a source page, names a source or page that is not registered, or the
 * store lacks the body. What lets a hosted repository open a page before the
 * scan that would snapshot it.
 */
export async function readSpecSourceDoc(repoKey: string, ref: string): Promise<string | null> {
  const parsed = parseSpecSourceRef(ref);
  if (!parsed) return null;
  const registry = await active.readRegistry(repoKey);
  const source = registry.sources.find((s) => s.id === parsed.sourceId);
  const doc = source?.docs.find((d) => d.path === parsed.docPath);
  if (!doc) return null;
  return active.readBody(repoKey, doc.contentHash);
}

/**
 * Put a repo's stored sources into a tree, where the engine reads them as the
 * registry and its files. A repo with nothing registered writes nothing.
 */
export async function materializeSpecSources(repoKey: string, treeDir: string): Promise<void> {
  const registry = await active.readRegistry(repoKey);
  if (registry.sources.length === 0) return;
  const bodies: Record<string, string> = {};
  for (const source of registry.sources) {
    for (const doc of source.docs) {
      if (doc.contentHash in bodies) continue;
      const body = await active.readBody(repoKey, doc.contentHash);
      if (body != null) bodies[doc.contentHash] = body;
    }
  }
  writeSpecSourcesToTree(treeDir, { registry, bodies });
}

/**
 * Run the file-based engine over the repo's sources. In place for a working
 * tree; a hosted repo gets a scratch tree holding its stored sources, and what
 * the engine left there is stored back once `fn` returns — a throw stores
 * nothing, so a fetch that died leaves the registry as it was.
 */
export async function withSpecSourcesTree<T>(
  repoKey: string,
  fn: (treeDir: string) => Promise<T> | T,
): Promise<T> {
  if (active.materializesInPlace) return fn(repoKey);
  const treeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-spec-sources-'));
  try {
    await materializeSpecSources(repoKey, treeDir);
    const result = await fn(treeDir);
    await active.write(repoKey, readSpecSourcesFromTree(treeDir));
    return result;
  } finally {
    fs.rmSync(treeDir, { recursive: true, force: true });
  }
}
