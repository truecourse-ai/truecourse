import { existsSync, openSync, readFileSync, readSync, readdirSync, statSync, closeSync } from 'fs'
import { execFileSync } from 'child_process'
import { join, relative, resolve } from 'path'
import ignore from 'ignore'
import { detectLanguage, getAllIgnorePatterns, getAllTestPatterns } from './language-config.js'

// Minified/bundled JS or TS files have no analytical value (they're build
// artifacts of source already in the repo, or vendored libraries) and they
// produce huge amounts of FP noise across many rules. The `**/*.min.*` glob
// catches files that follow the convention; this content sniff catches the
// rest - vendored bundles named `*.production.js`, `*.bundle.js`, or weirder.
//
// Heuristic: a JS/TS file larger than `MIN_SIZE_FOR_SNIFF` whose first
// `SNIFF_BYTES` window contains fewer than `MIN_NEWLINES` newlines is
// almost certainly minified. The numbers are tuned to keep large
// hand-written source (1000s of normal lines) discoverable while excluding
// 50KB+ single-IIFE bundles.
const SNIFFED_EXTS = new Set(['.js', '.jsx', '.cjs', '.mjs', '.ts', '.tsx', '.mts', '.cts'])
const MIN_SIZE_FOR_SNIFF = 50 * 1024 // 50KB
const SNIFF_BYTES = 8 * 1024 // 8KB
const MIN_NEWLINES = 4

function looksMinified(absPath: string): boolean {
  // Cheap extension check first.
  const dotIdx = absPath.lastIndexOf('.')
  if (dotIdx < 0) return false
  const ext = absPath.slice(dotIdx)
  if (!SNIFFED_EXTS.has(ext)) return false

  let size: number
  try {
    size = statSync(absPath).size
  } catch {
    return false
  }
  if (size < MIN_SIZE_FOR_SNIFF) return false

  let fd: number | null = null
  try {
    fd = openSync(absPath, 'r')
    const buf = Buffer.alloc(SNIFF_BYTES)
    const read = readSync(fd, buf, 0, SNIFF_BYTES, 0)
    let newlines = 0
    for (let i = 0; i < read; i++) {
      if (buf[i] === 0x0a) newlines++
      if (newlines >= MIN_NEWLINES) return false
    }
    return true
  } catch {
    return false
  } finally {
    if (fd !== null) {
      try { closeSync(fd) } catch { /* ignore */ }
    }
  }
}

function isInsideGitWorkTree(dir: string): boolean {
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.toString('utf8').trim() === 'true'
  } catch {
    return false
  }
}

// Build the post-git filter: .truecourseignore + language test/ignore patterns
// + .git. Rooted at `dir` so .truecourseignore patterns are anchored correctly.
function buildPostGitFilter(dir: string): ReturnType<typeof ignore> {
  const ig = ignore()
  const tcPath = join(dir, '.truecourseignore')
  if (existsSync(tcPath)) ig.add(readFileSync(tcPath, 'utf8'))
  ig.add('.git')
  for (const p of getAllTestPatterns()) ig.add(p)
  for (const p of getAllIgnorePatterns()) ig.add(p)
  return ig
}

// Use git for full gitignore semantics: nested .gitignore, .git/info/exclude,
// the configured global excludes file, and the repo boundary. Returns null
// when `dir` is not in a git work tree or git is unavailable.
function discoverFilesViaGit(dir: string): string[] | null {
  if (!isInsideGitWorkTree(dir)) return null

  let stdout: Buffer
  try {
    stdout = execFileSync(
      'git',
      ['-C', dir, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'],
      { maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    ) as Buffer
  } catch {
    return null
  }

  const relPaths = stdout.toString('utf8').split('\0').filter(Boolean)
  // git emits a flat lexicographic order; the walker emits depth-first per-
  // directory order. They diverge when a directory and a sibling file share
  // a prefix (e.g. `foo/` and `foo.ts`). Downstream service/layer detection
  // is order-sensitive, so re-sort to match the walker.
  relPaths.sort(compareDepthFirst)
  const ig = buildPostGitFilter(dir)

  const out: string[] = []
  for (const rel of relPaths) {
    if (ig.ignores(rel)) continue
    const abs = join(dir, rel)
    let isFile = false
    try {
      isFile = statSync(abs).isFile()
    } catch {
      continue
    }
    if (!isFile) continue
    if (!detectLanguage(abs)) continue
    if (looksMinified(abs)) continue
    out.push(abs)
  }
  return out
}

function compareDepthFirst(a: string, b: string): number {
  const ap = a.split('/')
  const bp = b.split('/')
  const len = Math.min(ap.length, bp.length)
  for (let i = 0; i < len; i++) {
    const x = ap[i]!
    const y = bp[i]!
    if (x !== y) return x < y ? -1 : 1
  }
  return ap.length - bp.length
}

// Find all .gitignore files from startDir up to root.
// Returns array of {path, dir} objects, ordered from root to startDir.
function findAllGitignores(startDir: string): Array<{ path: string; dir: string }> {
  const gitignores: Array<{ path: string; dir: string }> = []
  let currentDir = resolve(startDir)

  while (true) {
    const gitignorePath = join(currentDir, '.gitignore')
    if (existsSync(gitignorePath)) {
      gitignores.unshift({ path: gitignorePath, dir: currentDir })
    }

    const parentDir = resolve(currentDir, '..')
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  return gitignores
}

// Re-anchor leading-/internal-slash patterns to baseDir so they still match
// when a parent .gitignore makes rootDir an ancestor of baseDir.
function reanchorTruecourseignore(content: string, prefix: string): string {
  if (prefix === '' || prefix === '.') return content

  return content
    .split('\n')
    .map((line) => {
      const raw = line
      const trimmed = raw.trim()
      if (trimmed === '' || trimmed.startsWith('#')) return raw

      const negate = trimmed.startsWith('!')
      const body = negate ? trimmed.slice(1) : trimmed

      if (body.startsWith('**/')) return raw

      const hasLeadingSlash = body.startsWith('/')
      const withoutTrailing = body.endsWith('/') ? body.slice(0, -1) : body
      const inner = hasLeadingSlash ? withoutTrailing.slice(1) : withoutTrailing
      const hasInternalSlash = inner.includes('/')

      if (!hasLeadingSlash && !hasInternalSlash) return raw

      const stripped = hasLeadingSlash ? body.slice(1) : body
      return `${negate ? '!' : ''}${prefix}/${stripped}`
    })
    .join('\n')
}

function loadIgnorePatterns(baseDir: string): { ig: ReturnType<typeof ignore>; rootDir: string } {
  const ig = ignore()

  const gitignores = findAllGitignores(baseDir)
  const rootDir = gitignores.length > 0 && gitignores[0] ? gitignores[0].dir : baseDir

  for (const { path: gitignorePath } of gitignores) {
    ig.add(readFileSync(gitignorePath, 'utf8'))
  }

  const truecourseignorePath = join(baseDir, '.truecourseignore')
  if (existsSync(truecourseignorePath)) {
    const content = readFileSync(truecourseignorePath, 'utf8')
    const prefix = relative(rootDir, baseDir).replace(/\\/g, '/')
    ig.add(reanchorTruecourseignore(content, prefix))
  }

  ig.add('.git')

  for (const pattern of getAllTestPatterns()) ig.add(pattern)
  for (const pattern of getAllIgnorePatterns()) ig.add(pattern)

  return { ig, rootDir }
}

// Manual walker — used when `dir` is not in a git work tree (e.g. test temp
// dirs without git init). git delegation is preferred when available because
// it gets nested-.gitignore anchoring, .git/info/exclude, the global excludes
// file, and the repo boundary right.
function discoverFilesViaWalker(dir: string): string[] {
  const files: string[] = []
  const { ig, rootDir } = loadIgnorePatterns(dir)

  function traverse(currentPath: string) {
    try {
      // Sort for deterministic traversal — APFS and ext4 return entries in
      // different orders, and downstream service/layer detection is order-
      // sensitive.
      const entries = readdirSync(currentPath).sort()

      for (const entry of entries) {
        const fullPath = join(currentPath, entry)
        const relativePath = relative(rootDir, fullPath)
        const stat = statSync(fullPath)

        const pathToCheck = stat.isDirectory() ? relativePath + '/' : relativePath
        if (ig.ignores(pathToCheck)) continue

        if (stat.isDirectory()) {
          traverse(fullPath)
        } else if (stat.isFile()) {
          if (!detectLanguage(fullPath)) continue
          if (looksMinified(fullPath)) continue
          files.push(fullPath)
        }
      }
    } catch {
      // Skip directories we can't read.
    }
  }

  traverse(dir)
  return files
}

/**
 * Discover all supported source files in a directory.
 * Respects .gitignore (incl. nested), .git/info/exclude, the configured
 * global excludes file, and .truecourseignore.
 */
export function discoverFiles(dir: string): string[] {
  const viaGit = discoverFilesViaGit(dir)
  if (viaGit !== null) return viaGit
  return discoverFilesViaWalker(dir)
}
