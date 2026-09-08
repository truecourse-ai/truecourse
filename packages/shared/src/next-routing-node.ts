import fs from 'node:fs'
import path from 'node:path'
import { manifestDeclaresNext, NEXT_CONFIG, nearestNextRoot, nextRouterRoots } from './next-routing.js'

function directoryFiles(directory: string): string[] {
  try { return fs.readdirSync(directory) } catch { return [] }
}

function readManifest(directory: string): unknown {
  try { return JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) } catch { return null }
}

/** Manifest evidence for the web mapper, bounded to the repository. */
export function discoverNextAppRoots(repoRoot: string, files: readonly string[]): string[] {
  const root = path.resolve(repoRoot)
  const visited = new Set<string>()
  const roots: string[] = []
  for (const file of files) {
    let directory = path.dirname(path.resolve(root, file))
    while (directory === root || directory.startsWith(`${root}${path.sep}`)) {
      if (visited.has(directory)) break
      visited.add(directory)
      if (manifestDeclaresNext(readManifest(directory))) roots.push(directory)
      if (directory === root) break
      directory = path.dirname(directory)
    }
  }
  return roots.sort()
}

/** Resolve a file against its nearest package/config, never a guessed `app` ancestor. */
export function nextAppRouterForFile(filePath: string): string | null {
  const file = path.resolve(filePath)
  let directory = path.dirname(file)
  while (true) {
    const entries = directoryFiles(directory)
    const config = entries.some((entry) => NEXT_CONFIG.test(entry))
    if (config || manifestDeclaresNext(readManifest(directory))) {
      // Include directory evidence even if app/ is empty: it still shadows src/app/.
      let hasApp = false
      try { hasApp = fs.statSync(path.join(directory, 'app')).isDirectory() } catch { /* absent */ }
      const normalized = directory.split(path.sep).join('/')
      const normalizedFile = file.split(path.sep).join('/')
      return nearestNextRoot(nextRouterRoots({
        nextAppRoots: [normalized],
        files: hasApp ? [normalizedFile, `${normalized}/app/`] : [normalizedFile],
      }, 'app'), normalizedFile)
    }
    // A separate package or repository cannot borrow its parent's Next dependency.
    if (entries.includes('package.json') || entries.includes('.git')) return null
    const parent = path.dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}
