import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { LanguageServiceDetector } from './types.js'

export const pythonServiceDetector: LanguageServiceDetector = {
  readDependencies(servicePath) {
    const deps: string[] = []

    // requirements.txt
    const reqPath = join(servicePath, 'requirements.txt')
    if (existsSync(reqPath)) {
      try {
        const content = readFileSync(reqPath, 'utf-8')
        for (const line of content.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue
          const pkgName = trimmed.split(/[>=<!\[;]/)[0].trim().toLowerCase()
          if (pkgName) deps.push(pkgName)
        }
      } catch { /* skip */ }
    }

    // pyproject.toml
    const pyprojectPath = join(servicePath, 'pyproject.toml')
    if (existsSync(pyprojectPath)) {
      try {
        const content = readFileSync(pyprojectPath, 'utf-8')
        const depsMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/m)
        if (depsMatch) {
          const depMatches = depsMatch[1].matchAll(/"([^"]+)"|'([^']+)'/g)
          for (const match of depMatches) {
            const dep = (match[1] || match[2]).split(/[>=<!\[;]/)[0].trim().toLowerCase()
            if (dep) deps.push(dep)
          }
        }
      } catch { /* skip */ }
    }

    return deps
  },

  isLibrary(servicePath, files, hasApiIndicators, hasWorkerIndicators) {
    const hasPythonFiles = files.some((f) => f.endsWith('.py'))
    if (!hasPythonFiles || hasApiIndicators || hasWorkerIndicators) return false

    const hasInitPy = existsSync(join(servicePath, '__init__.py'))
    return hasInitPy
  },
}
