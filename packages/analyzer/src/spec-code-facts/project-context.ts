import { readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { CodeFactProjectContext } from './types.js'
import { normalizePath, repoRelativePath } from './utils.js'

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const
const NEXT_CONFIG_FILE = /^next\.config\.(?:js|mjs|cjs|ts|mts|cts)$/i

function repoRelativeDir(rootDir: string, absPath: string): string {
  const relPath = repoRelativePath(rootDir, dirname(absPath))
  return relPath === '.' ? '' : relPath
}

function manifestHasNextDependency(absPath: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(absPath, 'utf8'))
  } catch {
    return false
  }

  if (!parsed || typeof parsed !== 'object') return false
  const manifest = parsed as Record<string, unknown>
  return DEPENDENCY_FIELDS.some((field) => {
    const deps = manifest[field]
    return Boolean(deps && typeof deps === 'object' && Object.hasOwn(deps, 'next'))
  })
}

function isAtOrBelow(path: string, root: string): boolean {
  return root === '' || path === root || path.startsWith(`${root}/`)
}

function depth(path: string): number {
  return path === '' ? 0 : path.split('/').length
}

function nearestAncestor(path: string, roots: Set<string>): string | undefined {
  let best: string | undefined
  for (const root of roots) {
    if (!isAtOrBelow(path, root)) continue
    if (best === undefined || depth(root) > depth(best)) best = root
  }
  return best
}

export function createCodeFactProjectContext(rootDir: string, files: string[]): CodeFactProjectContext {
  const packageRoots = new Set<string>()
  const nextjsProjectRoots = new Set<string>()

  for (const absPath of files) {
    const fileName = basename(absPath)
    if (fileName === 'package.json') {
      const packageRoot = repoRelativeDir(rootDir, absPath)
      packageRoots.add(packageRoot)
      if (manifestHasNextDependency(absPath)) nextjsProjectRoots.add(packageRoot)
      continue
    }

    if (NEXT_CONFIG_FILE.test(fileName)) {
      nextjsProjectRoots.add(repoRelativeDir(rootDir, absPath))
    }
  }

  return { packageRoots, nextjsProjectRoots }
}

export function nextjsProjectRootFor(sourceFile: string, context: CodeFactProjectContext): string | undefined {
  const normalized = normalizePath(sourceFile)
  const nextRoot = nearestAncestor(normalized, context.nextjsProjectRoots)
  if (nextRoot === undefined) return undefined

  const packageRoot = nearestAncestor(normalized, context.packageRoots)
  if (packageRoot !== undefined && !isAtOrBelow(nextRoot, packageRoot)) return undefined
  return nextRoot
}

export function sourceFileWithinProjectRoot(sourceFile: string, projectRoot: string): string {
  const normalized = normalizePath(sourceFile)
  return projectRoot === '' ? normalized : normalized.slice(projectRoot.length + 1)
}

export function isInsideNextjsProject(sourceFile: string, context: CodeFactProjectContext): boolean {
  return nextjsProjectRootFor(sourceFile, context) !== undefined
}
