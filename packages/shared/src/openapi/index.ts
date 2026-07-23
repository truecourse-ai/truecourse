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
 * External `$ref` resolution (splitting a spec across files, e.g. an entry
 * `openapi.yml` referencing per-area path files that reference shared schema
 * files) is OPT-IN: pass a
 * {@link RefResolutionContext} and a pre-pass ({@link inlineExternalRefs}) inlines
 * every external target BEFORE the in-file `#/…` resolver runs. Without a ctx only
 * in-file pointers are dereferenced (external refs stay literal `{ $ref }`), so an
 * all-in-file spec derives byte-identically with or without a ctx — the pre-pass
 * is a strict no-op on `#/…` refs.
 *
 * `readFile` is INJECTED (node callers wrap `fs.readFileSync`) and all path math is
 * a pure POSIX helper, so this module imports no node builtins and stays
 * browser-safe. Still deferred: auth/security schemes and recipe auto-suggestion.
 */

import yaml from 'js-yaml';

// The response-conformance validator (`expect.schema: true`) lives in a sibling
// module; re-exported here so `@truecourse/shared/openapi` stays its one import site.
export { validateAgainstSchema, responseJsonSchema, type SchemaViolation } from './validate.js';

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
export const HTTP_METHODS: readonly string[] = [
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
 * How the resolver reads external `$ref` targets and where its escape boundary is.
 * `readFile` is injected so this module never imports `node:fs` (browser-safe);
 * node callers pass a thin wrapper over `fs.readFileSync` that returns `null` on
 * any read error. `specPath`/`repoRoot` MUST be absolute POSIX-style paths.
 */
export interface RefResolutionContext {
  /** Absolute path of the entry spec file — the base for its own relative refs. */
  specPath: string;
  /** Absolute repo root — the escape boundary; a ref resolving outside it degrades. */
  repoRoot: string;
  /** Read an absolute path's text, or `null` when it can't be read. */
  readFile: (abs: string) => string | null;
}

/**
 * Thrown when the sum of the entry spec plus every distinct external file read
 * during resolution exceeds {@link OPENAPI_MAX_BYTES}. {@link deriveOpenApiSections}
 * catches it and returns `[]`; discovery uses {@link isResolvedOpenApiWithinCap} to
 * refuse admitting an over-cap split spec (estimate/runtime symmetry).
 */
export class OpenApiOversizeError extends Error {
  constructor(public readonly bytes: number) {
    super(`resolved OpenAPI document exceeds ${OPENAPI_MAX_BYTES} bytes (${bytes})`);
    this.name = 'OpenApiOversizeError';
  }
}

/**
 * Slice an OpenAPI document into its operation sections, in document order.
 * Returns `[]` when the content is not an OpenAPI doc or declares no paths. Both
 * the guard runner's section index and (via it) the generator go through this
 * function, so generate and run derive byte-identical identities.
 *
 * With a {@link RefResolutionContext} a pre-pass inlines external `$ref` targets
 * (split specs) before the in-file resolver runs; without one, external refs are
 * left as literal `{ $ref }` (in-file-only behavior). An over-cap resolved size
 * ({@link OpenApiOversizeError}) degrades to `[]`.
 */
export function deriveOpenApiSections(content: string, ctx?: RefResolutionContext): OpenApiOperationSection[] {
  const parsed = parseOpenApiSpec(content);
  if (!parsed) return [];
  let doc = parsed;
  if (ctx) {
    try {
      doc = inlineExternalRefs(parsed, content, ctx) as OpenApiDoc;
    } catch (err) {
      if (err instanceof OpenApiOversizeError) return [];
      throw err;
    }
  }
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
 * The JSON request-body schema an operation declares, or `undefined` when it
 * declares none. Reads `requestBody.content['application/json'].schema`, falling
 * back to the first JSON-family media type (a `.../json` or `...+json` key, e.g.
 * `application/merge-patch+json`).
 * The operation slice is already `$ref`-resolved by {@link deriveOpenApiSections},
 * so the returned schema needs no further dereferencing. Used by the guard
 * generator to author write-op request bodies against the declared shape.
 */
export function requestBodyJsonSchema(operation: unknown): unknown | undefined {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return undefined
  const rb = (operation as Record<string, unknown>).requestBody
  if (!rb || typeof rb !== 'object' || Array.isArray(rb)) return undefined
  const content = (rb as Record<string, unknown>).content
  if (!content || typeof content !== 'object' || Array.isArray(content)) return undefined
  const c = content as Record<string, unknown>
  let media = c['application/json']
  if (media === undefined) {
    const jsonKey = Object.keys(c).find((k) => /\/json$|\+json$/i.test(k))
    if (jsonKey) media = c[jsonKey]
  }
  if (!media || typeof media !== 'object' || Array.isArray(media)) return undefined
  const schema = (media as Record<string, unknown>).schema
  return schema === undefined ? undefined : schema
}

/**
 * The server base path an OpenAPI document prepends to every operation path, as a
 * normalized path string (leading slash, no trailing slash), or `''` when the doc
 * declares none — no `servers`, an empty url, `url: "/"`, or a full url with no path.
 *
 * Only the PATH portion of the server url is used. A full url
 * (`https://host/api/v1`) or a templated url (`{scheme}://host/api/{version}`)
 * contributes just its path (`/api/v1`, `/api/{version}`) — template braces are kept
 * so the guard runner's segment folder wildcards them the same way it folds path
 * params. When several servers are declared the FIRST one wins.
 *
 * The runner uses this to reunite a bound operation's bare `paths`-key path with the
 * base path so it matches scenario request URLs (which include the base path).
 * `deriveOpenApiSections` intentionally does NOT bake this into `canonicalText`,
 * keeping fingerprints stable against `servers` edits.
 */
export function openApiServerBasePath(content: string): string {
  const doc = parseOpenApiSpec(content)
  if (!doc) return ''
  const servers = (doc as Record<string, unknown>).servers
  if (!Array.isArray(servers) || servers.length === 0) return ''
  const first = servers[0]
  if (!first || typeof first !== 'object' || Array.isArray(first)) return ''
  const url = (first as Record<string, unknown>).url
  if (typeof url !== 'string') return ''
  return normalizeBasePath(serverUrlPath(url))
}

/** The path portion of a server url: path-only, full-url, or templated `{v}://…`. */
function serverUrlPath(url: string): string {
  const scheme = url.indexOf('://')
  if (scheme !== -1) {
    const afterAuthority = url.slice(scheme + 3)
    const slash = afterAuthority.indexOf('/')
    return slash === -1 ? '' : afterAuthority.slice(slash)
  }
  return url.startsWith('/') ? url : ''
}

/** Leading slash, no trailing slash; `''` for an empty path or bare root (`/`). */
function normalizeBasePath(p: string): string {
  let s = p.trim().replace(/\/+$/, '')
  if (s === '') return ''
  if (!s.startsWith('/')) s = '/' + s
  return s
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

/**
 * True when the spec's fully-resolved size (entry + every distinct external file
 * read) is within {@link OPENAPI_MAX_BYTES}. Discovery calls this at admit time so
 * an over-cap split spec is refused identically by the runtime and the pre-flight
 * estimate. Non-OpenApi content is trivially within cap (nothing to resolve).
 */
export function isResolvedOpenApiWithinCap(content: string, ctx: RefResolutionContext): boolean {
  const doc = parseOpenApiSpec(content);
  if (!doc) return true;
  try {
    inlineExternalRefs(doc, content, ctx);
    return true;
  } catch (err) {
    if (err instanceof OpenApiOversizeError) return false;
    throw err;
  }
}

/**
 * Pre-pass: return a copy of `entryDoc` with every EXTERNAL `$ref` inlined, so the
 * downstream in-file resolver ({@link resolveRefs}) sees a single self-contained
 * document. In-file `#/…` refs at the ENTRY level are left untouched (the entry
 * resolver dereferences them against the whole doc) — that no-op is what keeps an
 * all-in-file spec byte-identical with or without a ctx. An in-file ref that
 * appears INSIDE an external file is resolved here against that file's own root
 * (the entry resolver would have the wrong root).
 *
 * Escape/absolute/network targets are never read — they degrade to a literal
 * `{ $ref }`. Cycles are broken per stack-scoped visited set keyed `abs#fragment`,
 * so a diamond inlines fully and only true back-edges degrade. The running byte
 * total (entry + each distinct external file) is capped at {@link OPENAPI_MAX_BYTES}.
 */
function inlineExternalRefs(entryDoc: OpenApiDoc, entryContent: string, ctx: RefResolutionContext): unknown {
  const repoRootAbs = posixNormalize(ctx.repoRoot);
  const entryAbs = posixNormalize(ctx.specPath);
  const entryDir = posixDirname(entryAbs);
  const readBytes = new Map<string, number>([[entryAbs, entryContent.length]]);
  const parsedCache = new Map<string, unknown>();

  const accrue = (abs: string, text: string): void => {
    if (readBytes.has(abs)) return;
    readBytes.set(abs, text.length);
    let total = 0;
    for (const n of readBytes.values()) total += n;
    if (total > OPENAPI_MAX_BYTES) throw new OpenApiOversizeError(total);
  };

  /** Load + parse an external file once (cached). `null` when unreadable/non-object. */
  const loadFile = (abs: string): unknown => {
    if (parsedCache.has(abs)) return parsedCache.get(abs);
    const text = ctx.readFile(abs);
    if (text == null) {
      parsedCache.set(abs, null);
      return null;
    }
    accrue(abs, text);
    let parsed: unknown;
    try {
      parsed = yaml.load(text);
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object') parsed = null;
    parsedCache.set(abs, parsed);
    return parsed;
  };

  /**
   * Walk `node`, inlining external refs. `fileRoot`/`fileAbs`/`fileDir` describe the
   * file the node currently lives in (entry or an external target); `isEntry` gates
   * the in-file no-op. `stack` is the active `abs#fragment` chain for cycle-breaking.
   */
  const walk = (
    node: unknown,
    fileRoot: unknown,
    fileAbs: string,
    fileDir: string,
    isEntry: boolean,
    stack: Set<string>,
  ): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(n, fileRoot, fileAbs, fileDir, isEntry, stack));
    if (!node || typeof node !== 'object') return node;
    const obj = node as Record<string, unknown>;
    const ref = obj.$ref;
    if (typeof ref === 'string') {
      // In-file pointer.
      if (ref.startsWith('#')) {
        if (isEntry) return { $ref: ref }; // leave for the downstream entry resolver
        // Inside an external file: resolve against that file's own root now.
        const target = resolvePointer(fileRoot, ref);
        if (target === undefined) return { $ref: ref };
        const key = `${fileAbs}${ref}`;
        if (stack.has(key)) return { $ref: ref };
        stack.add(key);
        try {
          return walk(target, fileRoot, fileAbs, fileDir, false, stack);
        } finally {
          stack.delete(key);
        }
      }
      // External ref: split file part from fragment.
      const hash = ref.indexOf('#');
      const filePart = hash === -1 ? ref : ref.slice(0, hash);
      const fragment = hash === -1 ? '' : ref.slice(hash + 1);
      // Network or absolute targets are never read.
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(filePart) || filePart.startsWith('//') || filePart.startsWith('/')) {
        return { $ref: ref };
      }
      const targetAbs = posixNormalize(posixJoin(fileDir, filePart));
      // Escape boundary: the target must live inside repoRoot.
      if (targetAbs !== repoRootAbs && !targetAbs.startsWith(repoRootAbs.replace(/\/?$/, '/'))) {
        return { $ref: ref };
      }
      const targetRoot = loadFile(targetAbs);
      if (targetRoot == null) return { $ref: ref };
      const pointer = fragment === '' ? '' : '#' + (fragment.startsWith('/') ? fragment : '/' + fragment);
      const subtree = pointer === '' ? targetRoot : resolvePointer(targetRoot, pointer);
      if (subtree === undefined) return { $ref: ref };
      const key = `${targetAbs}#${fragment}`;
      if (stack.has(key)) return { $ref: ref }; // back-edge
      stack.add(key);
      const targetDir = posixDirname(targetAbs);
      try {
        return walk(subtree, targetRoot, targetAbs, targetDir, false, stack);
      } finally {
        stack.delete(key);
      }
    }
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) result[k] = walk(v, fileRoot, fileAbs, fileDir, isEntry, stack);
    return result;
  };

  return walk(entryDoc, entryDoc, entryAbs, entryDir, true, new Set());
}

// --- Pure POSIX path helpers (no node:path — keeps this module browser-safe) ---

/** Everything before the last `/`; `/` for a root child, `.` for a bare name. */
function posixDirname(p: string): string {
  const i = p.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  return p.slice(0, i);
}

/** Join a base dir and a relative segment with a single separator. */
function posixJoin(dir: string, rel: string): string {
  if (dir === '' || dir === '.') return rel;
  return `${dir.replace(/\/+$/, '')}/${rel}`;
}

/** Collapse `.`/`..` segments; drops `..` that would climb above an absolute root. */
function posixNormalize(p: string): string {
  const isAbs = p.startsWith('/');
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!isAbs) out.push('..');
    } else {
      out.push(part);
    }
  }
  const joined = out.join('/');
  return isAbs ? '/' + joined : joined || '.';
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
