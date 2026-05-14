import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import ignore from 'ignore'
import { normalizePath, repoRelativePath } from './utils.js'

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'])
const EXTRA_FACT_FILE_NAMES = new Set(['docker-compose.yml', 'docker-compose.yaml', 'schema.prisma'])
const EXTRA_FACT_PATH_PATTERNS = [
  /^\.github\/workflows\/[^/]+\.(ya?ml)$/i,
  /(^|\/)drizzle\/.*\.(ts|js|mts|mjs|cts|cjs)$/i,
  /(^|\/)(models?|schema|db)\/.*\.py$/i,
]
export const JSX_EXTENSIONS = new Set(['.tsx', '.jsx'])

const GENERATED_DIRS = new Set([
  '.git',
  '.truecourse',
  'node_modules',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'build',
  'out',
])

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

function loadTruecourseIgnore(rootDir: string): ReturnType<typeof ignore> {
  const ig = ignore()
  const truecourseignorePath = join(rootDir, '.truecourseignore')
  if (existsSync(truecourseignorePath)) ig.add(readFileSync(truecourseignorePath, 'utf8'))
  ig.add([...GENERATED_DIRS].map((dir) => `${dir}/`))
  return ig
}

function shouldIncludeCodeFactInput(relPath: string): boolean {
  const normalized = normalizePath(relPath)
  if (normalized.split('/').some((part) => GENERATED_DIRS.has(part))) return false
  if (basename(normalized) === 'package.json') return true
  if (EXTRA_FACT_FILE_NAMES.has(basename(normalized))) return true
  if (EXTRA_FACT_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) return true
  return CODE_EXTENSIONS.has(extname(normalized).toLowerCase())
}

function discoverViaGit(rootDir: string): string[] | null {
  if (!isInsideGitWorkTree(rootDir)) return null

  let stdout: Buffer
  try {
    stdout = execFileSync(
      'git',
      ['-C', rootDir, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'],
      { maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    ) as Buffer
  } catch {
    return null
  }

  const tcIgnore = loadTruecourseIgnore(rootDir)
  return stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(normalizePath)
    .filter((relPath) => shouldIncludeCodeFactInput(relPath) && !tcIgnore.ignores(relPath))
    .sort()
    .map((relPath) => join(rootDir, relPath))
}

function loadWalkerIgnore(rootDir: string): ReturnType<typeof ignore> {
  const ig = ignore()
  const gitignorePath = join(rootDir, '.gitignore')
  const truecourseignorePath = join(rootDir, '.truecourseignore')
  if (existsSync(gitignorePath)) ig.add(readFileSync(gitignorePath, 'utf8'))
  if (existsSync(truecourseignorePath)) ig.add(readFileSync(truecourseignorePath, 'utf8'))
  ig.add([...GENERATED_DIRS].map((dir) => `${dir}/`))
  return ig
}

export function discoverCodeFactInputs(rootDir: string): string[] {
  const resolvedRoot = resolve(rootDir)
  const viaGit = discoverViaGit(resolvedRoot)
  if (viaGit !== null) return viaGit

  const files: string[] = []
  const ig = loadWalkerIgnore(resolvedRoot)

  function traverse(currentPath: string): void {
    let entries: string[]
    try {
      entries = readdirSync(currentPath).sort()
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(currentPath, entry)
      const relPath = repoRelativePath(resolvedRoot, fullPath)

      let stat
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }

      const ignorePath = stat.isDirectory() ? `${relPath}/` : relPath
      if (GENERATED_DIRS.has(entry) && stat.isDirectory()) continue
      if (ig.ignores(ignorePath)) continue

      if (stat.isDirectory()) {
        traverse(fullPath)
      } else if (stat.isFile() && shouldIncludeCodeFactInput(relPath)) {
        files.push(fullPath)
      }
    }
  }

  traverse(resolvedRoot)
  return files.sort((a, b) => repoRelativePath(resolvedRoot, a).localeCompare(repoRelativePath(resolvedRoot, b)))
}
