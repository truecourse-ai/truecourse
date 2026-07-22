/**
 * OpenAPI-as-spec-source support — the ONE place TrueCourse detects an OpenAPI /
 * Swagger document and slices it into per-operation SECTIONS.
 *
 * An OpenAPI document is a first-class spec source: each operation (an HTTP
 * method on a path) becomes a bindable section that flows through the existing
 * extract → author → birth guard pipeline unchanged, and `guard run`'s
 * stale/orphan detection works on it. This module is imported by BOTH the guard
 * runner's section index (which the generator also uses) and spec-scan discovery,
 * so detection and canonical serialization have exactly one implementation.
 *
 * It is a SUBPATH export (`@truecourse/shared/openapi`), deliberately kept OUT of
 * the package root so the node-free dashboard client never pulls `js-yaml` into
 * its bundle. Everything here is browser-safe (js-yaml is pure JS), but only the
 * server-side packages need it.
 *
 * Deferred (PoC scope): external `$ref` resolution (only in-file `#/…` pointers
 * are dereferenced), auth/security schemes, and any recipe auto-suggestion.
 */

import yaml from 'js-yaml';

/**
 * File extensions that MAY carry an OpenAPI document. Deliberately narrow — a
 * cheap gate before any parse. `.json` is included because JSON is a subset of
 * YAML and `js-yaml` parses it; package.json/tsconfig/lockfiles share these
 * extensions but never carry a top-level `openapi`/`swagger` key, so the parse
 * confirm below rejects them.
 */
export const OPENAPI_DOC_EXTENSIONS: readonly string[] = ['.yaml', '.yml', '.json'];

/** Bytes of the file head read for the cheap key check before any full parse. */
export const OPENAPI_HEAD_BYTES = 8 * 1024;

/** Hard cap on the file size discovery will parse — a huge yaml/json is skipped. */
export const OPENAPI_MAX_BYTES = 5 * 1024 * 1024;

/** The HTTP methods that mark an operation inside a path item, in a stable order. */
const HTTP_METHODS: readonly string[] = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
];

/** True when `filePath` ends in an extension an OpenAPI doc might use. */
export function hasOpenApiExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return OPENAPI_DOC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * The cheap pre-parse gate: does a bounded head plausibly declare an OpenAPI /
 * Swagger version key? A permissive check on purpose — false positives are caught
 * by {@link parseOpenApiSpec}; its only job is to avoid fully parsing every
 * yaml/json in the tree. `package.json`/`tsconfig.json`/lockfiles have no such
 * key, so they never pass.
 */
export function looksLikeOpenApi(head: string): boolean {
  // A YAML top-level key (`openapi: 3.0.0`) or a JSON key (`"openapi":`).
  return /(?:^|[\n{,])[ \t]*["']?(?:openapi|swagger)["']?[ \t]*:/m.test(head);
}

/** A parsed OpenAPI/Swagger document — an object with a version + optional paths. */
export interface OpenApiDoc {
  [key: string]: unknown;
  paths?: Record<string, unknown>;
}

/**
 * Parse content as an OpenAPI/Swagger document, or `null` when it is not one.
 * `js-yaml` parses JSON too (JSON ⊂ YAML). The discriminator is a STRING
 * `openapi` or `swagger` top-level key — the version marker every spec carries
 * and no manifest/lockfile does.
 */
export function parseOpenApiSpec(content: string): OpenApiDoc | null {
  let doc: unknown;
  try {
    doc = yaml.load(content);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const obj = doc as Record<string, unknown>;
  const version = obj.openapi ?? obj.swagger;
  if (typeof version !== 'string') return null;
  return obj as OpenApiDoc;
}

/**
 * The single detection predicate: `filePath` has an OpenAPI-capable extension AND
 * its content parses to a document with a top-level `openapi`/`swagger` version.
 * The bounded head gate keeps a non-spec yaml/json from being fully parsed.
 */
export function isOpenApiDoc(filePath: string, content: string): boolean {
  if (!hasOpenApiExtension(filePath)) return false;
  if (!looksLikeOpenApi(content.slice(0, OPENAPI_HEAD_BYTES))) return false;
  return parseOpenApiSpec(content) !== null;
}

/** One derived operation section: its identity inputs plus its canonical text. */
export interface OpenApiOperationSection {
  /** Lowercase HTTP method (`get`, `post`, …). */
  method: string;
  /** The raw path template, verbatim (`/users/{id}`). */
  routePath: string;
  /** The operation's `operationId`, when present. */
  operationId?: string;
  /** The slug source for the anchor — `operationId` when present, else the path. */
  slugSource: string;
  /** Human-readable label (`GET /users/{id}`). */
  headingText: string;
  /**
   * The CANONICAL serialization of the resolved operation slice — a stable,
   * sorted-key JSON string of `{ method, path, operation }` with in-file `$ref`s
   * dereferenced. This is the fingerprinted section text: cosmetic reformatting
   * or key-reordering of the source file leaves it byte-identical, while any
   * change to the operation's meaning changes it.
   */
  canonicalText: string;
}

/**
 * Slice an OpenAPI document into its operation sections, in document order.
 * Returns `[]` when the content is not an OpenAPI doc or declares no paths. Both
 * the guard runner's section index and (via it) the generator go through this
 * function, so generate and run derive byte-identical identities.
 */
export function deriveOpenApiSections(content: string): OpenApiOperationSection[] {
  const doc = parseOpenApiSpec(content);
  if (!doc) return [];
  const paths = doc.paths;
  if (!paths || typeof paths !== 'object' || Array.isArray(paths)) return [];

  const out: OpenApiOperationSection[] = [];
  for (const [routePath, pathItemRaw] of Object.entries(paths as Record<string, unknown>)) {
    if (!pathItemRaw || typeof pathItemRaw !== 'object') continue;
    // A path item may itself be a `$ref` (or carry them); resolve in-file.
    const pathItem = resolveRefs(pathItemRaw, doc) as Record<string, unknown>;
    if (!pathItem || typeof pathItem !== 'object' || Array.isArray(pathItem)) continue;
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op || typeof op !== 'object' || Array.isArray(op)) continue;
      const resolvedOp = resolveRefs(op, doc);
      const operationId =
        typeof (op as Record<string, unknown>).operationId === 'string'
          ? ((op as Record<string, unknown>).operationId as string)
          : undefined;
      out.push({
        method,
        routePath,
        operationId,
        slugSource: operationId ?? routePath,
        headingText: `${method.toUpperCase()} ${routePath}`,
        canonicalText: canonicalStringify({ method, path: routePath, operation: resolvedOp }),
      });
    }
  }
  return out;
}

/**
 * Stable, sorted-key JSON of any value — object keys sorted recursively, arrays
 * left in order. Makes the serialization invariant to key-ordering in the source
 * document, so a cosmetic reorder never churns a fingerprint.
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortDeep(obj[key]);
    return out;
  }
  return value;
}

/**
 * Recursively dereference IN-FILE `$ref`s (`#/…` JSON pointers) against `root`.
 * External refs (anything not starting `#/`) and unresolvable/cyclic pointers are
 * left as a `{ $ref }` node — external resolution is deferred (PoC scope), and a
 * cycle must not loop forever.
 */
function resolveRefs(node: unknown, root: OpenApiDoc, seen: ReadonlySet<string> = new Set()): unknown {
  if (Array.isArray(node)) return node.map((n) => resolveRefs(n, root, seen));
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const ref = obj.$ref;
    if (typeof ref === 'string') {
      if (!ref.startsWith('#/')) return { $ref: ref }; // external — deferred
      if (seen.has(ref)) return { $ref: ref }; // cycle — stop
      const target = resolvePointer(root, ref);
      if (target === undefined) return { $ref: ref }; // unresolvable — leave as-is
      const nextSeen = new Set(seen);
      nextSeen.add(ref);
      return resolveRefs(target, root, nextSeen);
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) out[key] = resolveRefs(value, root, seen);
    return out;
  }
  return node;
}

/** Resolve a `#/a/b/c` JSON pointer against `root`, or `undefined` when missing. */
function resolvePointer(root: unknown, ref: string): unknown {
  const parts = ref
    .slice(2)
    .split('/')
    .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur: unknown = root;
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}
