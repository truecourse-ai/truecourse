import { readdirSync } from 'fs'
import { join } from 'path'
import type { LanguageServiceDetector } from './types.js'
import { readCsproj } from '../symbol-index/csproj.js'

function readServiceProjects(servicePath: string) {
  let entries: string[] = []
  try {
    entries = readdirSync(servicePath)
  } catch {
    return []
  }
  return entries
    .filter((f) => f.endsWith('.csproj'))
    .map((f) => readCsproj(join(servicePath, f)))
    .filter((p): p is NonNullable<typeof p> => p !== null)
}

export const csharpServiceDetector: LanguageServiceDetector = {
  detectType(servicePath) {
    // The project SDK is authoritative: directory-name heuristics can't
    // distinguish HTTP handlers from queue handlers, but the SDK can.
    for (const project of readServiceProjects(servicePath)) {
      if (project.sdk === 'Microsoft.NET.Sdk.Web') return 'api-server'
      if (project.sdk === 'Microsoft.NET.Sdk.Worker') return 'worker'
    }
    return null
  },

  readDependencies(servicePath) {
    const deps: string[] = []

    for (const project of readServiceProjects(servicePath)) {
      // The Web SDK implies the ASP.NET Core framework reference
      if (project.sdk === 'Microsoft.NET.Sdk.Web') {
        deps.push('microsoft.aspnetcore')
      }
      // The Worker SDK implies the generic host
      if (project.sdk === 'Microsoft.NET.Sdk.Worker') {
        deps.push('microsoft.extensions.hosting')
      }
      for (const pkg of project.packageReferences.keys()) {
        deps.push(pkg.toLowerCase())
      }
    }

    return deps
  },

  isLibrary(servicePath, files, hasApiIndicators, hasWorkerIndicators) {
    const hasCSharpFiles = files.some((f) => f.endsWith('.cs'))
    if (!hasCSharpFiles || hasApiIndicators || hasWorkerIndicators) return false

    for (const project of readServiceProjects(servicePath)) {
      // Web/Worker SDK projects are executables, not libraries
      if (project.sdk === 'Microsoft.NET.Sdk.Web' || project.sdk === 'Microsoft.NET.Sdk.Worker') {
        return false
      }
      if (project.outputType?.toLowerCase() === 'exe') {
        return false
      }
      // Plain Microsoft.NET.Sdk without an Exe output type — class library
      return true
    }

    return false
  },
}
