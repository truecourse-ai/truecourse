/**
 * Package-under-test resolution links. Scenario `setup.files` import the target
 * package the way its docs tell users to — by published name (`import 'tsx'`,
 * `require('tsx/cjs/api')`). The sandbox cwd is a bare temp dir, so without help
 * Node rejects those bare specifiers (MODULE_NOT_FOUND) before any behavior of
 * the package runs, and every programmatic-API scenario dies at birth.
 *
 * The engine therefore links each discovered package into the sandbox at
 * `node_modules/<name>` → its real directory — `npm link` semantics. Node
 * resolves through the link's realpath, so the package's own dependencies come
 * from the repo's real `node_modules` and subpaths (`pkg/sub`) resolve through
 * its actual `exports` map. Discovery covers the repo-root package and, for
 * monorepos, every workspace package (npm/yarn `workspaces` globs and
 * `pnpm-workspace.yaml`). A repo with no linkable package (non-Node targets)
 * yields an empty list and the sandbox is unchanged.
 */

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'

export interface PackageLink {
  /** The package's published name (`name` from its package.json). */
  name: string
  /** Absolute directory the sandbox `node_modules/<name>` link points at. */
  dir: string
}

interface PackageJson {
  name?: unknown
  workspaces?: unknown
}

/**
 * All packages a sandbox should make resolvable by name: the repo-root package
 * plus every workspace package. Deduplicated by name (root first), sorted
 * workspace order, packages without a valid name skipped.
 */
export function discoverPackageLinks(repoRoot: string): PackageLink[] {
  const links: PackageLink[] = []
  const seen = new Set<string>()
  const add = (pkg: PackageJson | null, dir: string): void => {
    const name = pkg?.name
    if (typeof name !== 'string' || !isLinkableName(name) || seen.has(name)) return
    seen.add(name)
    links.push({ name, dir })
  }
  const rootPkg = readPackageJson(repoRoot)
  add(rootPkg, repoRoot)
  for (const dir of workspaceDirs(repoRoot, rootPkg)) add(readPackageJson(dir), dir)
  return links
}

/**
 * A name is linkable when `node_modules/<name>` stays inside `node_modules`: a
 * bare name or a single-scope `@scope/name`, with no empty, `.`/`..`, or
 * backslash segments. Anything else is an invalid npm name anyway.
 */
function isLinkableName(name: string): boolean {
  const segs = name.split('/')
  if (segs.length > 2 || (segs.length === 2 && !segs[0].startsWith('@'))) return false
  return segs.every((s) => s.length > 0 && s !== '.' && s !== '..' && !s.includes('\\'))
}

/** Parse `<dir>/package.json`, or `null` when absent/unreadable/invalid JSON. */
function readPackageJson(dir: string): PackageJson | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as PackageJson) : null
  } catch {
    return null
  }
}

/**
 * Expand the repo's workspace globs into existing package directories.
 * Patterns come from the root package.json `workspaces` (array or `{ packages }`
 * form) plus `pnpm-workspace.yaml` `packages`; `!`-prefixed patterns exclude.
 */
function workspaceDirs(repoRoot: string, rootPkg: PackageJson | null): string[] {
  const patterns = workspacePatterns(repoRoot, rootPkg)
  const include = new Set<string>()
  for (const p of patterns.filter((p) => !p.startsWith('!'))) {
    for (const dir of expandPattern(repoRoot, p)) include.add(dir)
  }
  const exclude = new Set<string>()
  for (const p of patterns.filter((p) => p.startsWith('!'))) {
    for (const dir of expandPattern(repoRoot, p.slice(1))) exclude.add(dir)
  }
  return [...include].filter((d) => !exclude.has(d) && d !== repoRoot).sort()
}

function workspacePatterns(repoRoot: string, rootPkg: PackageJson | null): string[] {
  const patterns: string[] = []
  const ws = rootPkg?.workspaces
  if (Array.isArray(ws)) {
    patterns.push(...ws.filter((p): p is string => typeof p === 'string'))
  } else if (ws && typeof ws === 'object') {
    const pkgs = (ws as { packages?: unknown }).packages
    if (Array.isArray(pkgs)) patterns.push(...pkgs.filter((p): p is string => typeof p === 'string'))
  }
  const pnpmFile = path.join(repoRoot, 'pnpm-workspace.yaml')
  if (fs.existsSync(pnpmFile)) {
    try {
      const doc = yaml.load(fs.readFileSync(pnpmFile, 'utf-8'))
      const pkgs = (doc as { packages?: unknown } | null)?.packages
      if (Array.isArray(pkgs)) patterns.push(...pkgs.filter((p): p is string => typeof p === 'string'))
    } catch {
      // Malformed workspace file — the target repo's defect; workspace packages
      // simply stay unlinked (the pre-discovery state), never a crashed run.
    }
  }
  return patterns
}

/**
 * Expand one workspace glob into existing directories. Supports literal
 * segments, `*` (any name within one level), and `**` (any depth, including
 * none). `node_modules` and dot-directories are never traversed.
 */
function expandPattern(root: string, pattern: string): string[] {
  const segs = pattern.split('/').filter((s) => s !== '' && s !== '.')
  let dirs: string[] = [root]
  for (const seg of segs) {
    const next = new Set<string>()
    if (seg === '**') {
      for (const dir of dirs) for (const sub of descendantDirs(dir)) next.add(sub)
    } else if (seg.includes('*')) {
      const re = segmentRegex(seg)
      for (const dir of dirs) {
        for (const name of childDirs(dir)) if (re.test(name)) next.add(path.join(dir, name))
      }
    } else if (seg !== '..') {
      for (const dir of dirs) {
        const candidate = path.join(dir, seg)
        if (isDir(candidate)) next.add(candidate)
      }
    }
    dirs = [...next]
    if (dirs.length === 0) break
  }
  return dirs
}

/** `dir` plus every traversable descendant directory (the `**` expansion). */
function descendantDirs(dir: string): string[] {
  const out: string[] = [dir]
  for (const name of childDirs(dir)) out.push(...descendantDirs(path.join(dir, name)))
  return out
}

function childDirs(dir: string): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.'))
    .map((e) => e.name)
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** One glob segment → an anchored regex; `*` matches within the segment only. */
function segmentRegex(seg: string): RegExp {
  const escaped = seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  return new RegExp(`^${escaped}$`)
}
