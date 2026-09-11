/**
 * The ONE ref grammar for every document of the workspace corpus:
 *
 *     context/<sourceId>/<docPath>
 *
 * `docPath` is the repo-relative path for a repository source and the snapshot
 * path for a site. That ref is the document's address in the corpus, in claims,
 * in scenarios and in the Documents view, and it replaces the two old grammars
 * (`.truecourse/specs/sources/...` and `knowledge/...`).
 *
 * Nothing else composes or splits the string: build one with {@link contextDocRef}
 * and read one with {@link parseContextDocRef}, so the grammar can never drift
 * between the store, the routes and the scan.
 */

/** The first segment of every context ref. */
export const CONTEXT_REF_PREFIX = 'context';

export interface ContextDocRefParts {
  sourceId: string;
  docPath: string;
}

/**
 * A source id must be one clean path segment: it is the second segment of the
 * ref AND a directory name when the scan materializes the corpus into a tree.
 */
export function isValidContextSourceId(sourceId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sourceId) && sourceId !== '.' && sourceId !== '..';
}

/** A doc path must stay inside its source's directory and carry no drive/root. */
export function isValidContextDocPath(docPath: string): boolean {
  if (docPath === '' || docPath.startsWith('/') || /^[A-Za-z]:/.test(docPath)) return false;
  const segments = docPath.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** `context/<sourceId>/<docPath>` — the address of one document of the corpus. */
export function contextDocRef(sourceId: string, docPath: string): string {
  if (!isValidContextSourceId(sourceId)) {
    throw new Error(`Invalid context source id: ${JSON.stringify(sourceId)}`);
  }
  const normalized = docPath.split('\\').join('/');
  if (!isValidContextDocPath(normalized)) {
    throw new Error(`Invalid context document path: ${JSON.stringify(docPath)}`);
  }
  return `${CONTEXT_REF_PREFIX}/${sourceId}/${normalized}`;
}

/**
 * Read a context ref, or null when it is not one (a repo-relative doc path, a
 * legacy `knowledge/` ref, a ref that escapes its source's directory).
 */
export function parseContextDocRef(ref: string): ContextDocRefParts | null {
  if (!ref.startsWith(`${CONTEXT_REF_PREFIX}/`)) return null;
  const rest = ref.slice(CONTEXT_REF_PREFIX.length + 1);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const sourceId = rest.slice(0, slash);
  const docPath = rest.slice(slash + 1);
  if (!isValidContextSourceId(sourceId) || !isValidContextDocPath(docPath)) return null;
  return { sourceId, docPath };
}

/** Whether `ref` addresses a document of the workspace corpus. */
export function isContextDocRef(ref: string): boolean {
  return parseContextDocRef(ref) !== null;
}
