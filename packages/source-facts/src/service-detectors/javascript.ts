import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { LanguageServiceDetector } from './types.js'

export const jsServiceDetector: LanguageServiceDetector = {
  readDependencies(servicePath) {
    const packageJsonPath = join(servicePath, 'package.json')
    if (!existsSync(packageJsonPath)) return []

    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    } catch {
      return []
    }
  },

  isLibrary(servicePath) {
    const packageJsonPath = join(servicePath, 'package.json')
    if (!existsSync(packageJsonPath)) return false

    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      const libraryIndicators = ['main', 'module', 'exports', 'types', 'typings']
      return libraryIndicators.some((indicator) => pkg[indicator])
    } catch {
      return false
    }
  },
}
