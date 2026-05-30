import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import ignore from 'ignore'
import { minimatch } from 'minimatch'
import { SpecComplianceConfigSchema, type SpecComplianceConfig } from '@truecourse/shared'
import { DEFAULT_TRAVERSAL_EXCLUDED_DIRS, SUPPORTED_SPEC_EXTENSIONS } from './constants.js'
import { normalizePath, repoRelativePath } from './utils.js'

function matchesAny(relPath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const normalized = normalizePath(pattern)
    return minimatch(relPath, normalized, { dot: true })
      || (normalized.startsWith('**/') && minimatch(relPath, normalized.slice(3), { dot: true }))
  })
}

function shouldIncludeSpec(relPath: string, config: SpecComplianceConfig): boolean {
  const normalized = normalizePath(relPath)
  if (matchesAny(normalized, config.excludeGlobs)) return false
  if (!matchesAny(normalized, config.specGlobs)) return false
  return SUPPORTED_SPEC_EXTENSIONS.has(extname(normalized).toLowerCase())
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

function discoverSpecFilesViaGit(rootDir: string, config: SpecComplianceConfig): string[] | null {
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

  return stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(normalizePath)
    .filter((relPath) => shouldIncludeSpec(relPath, config))
    .sort()
    .map((relPath) => join(rootDir, relPath))
}

function loadWalkerIgnore(rootDir: string): ReturnType<typeof ignore> {
  const ig = ignore()
  const gitignorePath = join(rootDir, '.gitignore')
  const truecourseignorePath = join(rootDir, '.truecourseignore')

  if (existsSync(gitignorePath)) ig.add(readFileSync(gitignorePath, 'utf8'))
  if (existsSync(truecourseignorePath)) ig.add(readFileSync(truecourseignorePath, 'utf8'))

  ig.add([...DEFAULT_TRAVERSAL_EXCLUDED_DIRS].map((dir) => `${dir}/`))
  return ig
}

function discoverSpecFilesViaWalker(rootDir: string, config: SpecComplianceConfig): string[] {
  const files: string[] = []
  const ig = loadWalkerIgnore(rootDir)

  function traverse(currentPath: string): void {
    let entries: string[]
    try {
      entries = readdirSync(currentPath).sort()
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(currentPath, entry)
      const relPath = repoRelativePath(rootDir, fullPath)

      let stat
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }

      const ignorePath = stat.isDirectory() ? `${relPath}/` : relPath
      if (DEFAULT_TRAVERSAL_EXCLUDED_DIRS.has(entry) && stat.isDirectory()) continue
      if (ig.ignores(ignorePath)) continue

      if (stat.isDirectory()) {
        traverse(fullPath)
      } else if (stat.isFile() && shouldIncludeSpec(relPath, config)) {
        files.push(fullPath)
      }
    }
  }

  traverse(rootDir)
  return files.sort((a, b) => repoRelativePath(rootDir, a).localeCompare(repoRelativePath(rootDir, b)))
}

export function discoverSpecFiles(rootDir: string, configInput: Partial<SpecComplianceConfig> = {}): string[] {
  const resolvedRoot = resolve(rootDir)
  const config = SpecComplianceConfigSchema.parse(configInput)
  const viaGit = discoverSpecFilesViaGit(resolvedRoot, config)
  if (viaGit !== null) return viaGit
  return discoverSpecFilesViaWalker(resolvedRoot, config)
}
