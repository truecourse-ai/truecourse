/**
 * C# project file (.csproj) discovery and reading.
 *
 * A project ≈ an assembly: it scopes `internal` visibility, `global using`
 * directives, and ProjectReference edges between projects. Parsed with
 * regexes (MSBuild XML is simple and we only need a handful of properties),
 * matching the approach of the contract-verifier's manifest reader.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname, resolve } from 'path'

export interface CsprojInfo {
  /** Absolute path to the .csproj file */
  csprojPath: string
  /** Absolute directory containing the .csproj — files under it belong to this project */
  projectDir: string
  /** <RootNamespace>, falling back to the project file name */
  rootNamespace: string
  /** Project SDK (e.g. Microsoft.NET.Sdk.Web) */
  sdk?: string
  /** <OutputType> (e.g. Exe, Library) */
  outputType?: string
  /** <ImplicitUsings>enable</ImplicitUsings> — injects framework (System.*) global usings only */
  implicitUsings: boolean
  /** Absolute project dirs of <ProjectReference> entries */
  projectReferences: string[]
  /** <PackageReference> name → version ('' when centrally managed) */
  packageReferences: Map<string, string>
}

const SKIP_DIRS = new Set(['node_modules', 'bin', 'obj', '.git', '.vs', '.truecourse'])

/** Find every .csproj under rootPath (skipping build/VCS directories). */
export function discoverCsprojFiles(rootPath: string): string[] {
  const results: string[] = []

  function walk(dir: string) {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries.sort()) {
      if (SKIP_DIRS.has(entry)) continue
      const full = join(dir, entry)
      let stats
      try {
        stats = statSync(full)
      } catch {
        continue
      }
      if (stats.isDirectory()) {
        walk(full)
      } else if (entry.endsWith('.csproj')) {
        results.push(full)
      }
    }
  }

  walk(rootPath)
  return results
}

function matchProperty(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}>\\s*([^<]+?)\\s*</${name}>`, 'i'))
  return m ? m[1] : undefined
}

/** Read a single .csproj. Returns null when the file can't be read. */
export function readCsproj(csprojPath: string): CsprojInfo | null {
  let xml: string
  try {
    xml = readFileSync(csprojPath, 'utf-8')
  } catch {
    return null
  }

  const projectDir = dirname(csprojPath)
  const fileName = csprojPath.split(/[\\/]/).pop() ?? ''
  const defaultNamespace = fileName.replace(/\.csproj$/, '')

  const sdkMatch = xml.match(/<Project\s+Sdk\s*=\s*"([^"]+)"/i)

  const projectReferences: string[] = []
  for (const m of xml.matchAll(/<ProjectReference\s+[^>]*Include\s*=\s*"([^"]+)"/gi)) {
    // MSBuild paths use backslashes regardless of platform
    const rel = m[1].replace(/\\/g, '/')
    projectReferences.push(dirname(resolve(projectDir, rel)))
  }

  const packageReferences = new Map<string, string>()
  for (const m of xml.matchAll(/<PackageReference\s+[^>]*Include\s*=\s*"([^"]+)"(?:[^>]*Version\s*=\s*"([^"]+)")?/gi)) {
    packageReferences.set(m[1], m[2] ?? '')
  }

  return {
    csprojPath,
    projectDir,
    rootNamespace: matchProperty(xml, 'RootNamespace') ?? defaultNamespace,
    sdk: sdkMatch?.[1],
    outputType: matchProperty(xml, 'OutputType'),
    implicitUsings: /<ImplicitUsings>\s*enable\s*<\/ImplicitUsings>/i.test(xml),
    projectReferences,
    packageReferences,
  }
}

/** Discover and read all projects under rootPath. */
export function discoverProjects(rootPath: string): CsprojInfo[] {
  const projects: CsprojInfo[] = []
  for (const csprojPath of discoverCsprojFiles(rootPath)) {
    const info = readCsproj(csprojPath)
    if (info) projects.push(info)
  }
  return projects
}

/**
 * Map each file to its owning project: the project whose directory is the
 * nearest ancestor of the file. Files outside any project map to nothing.
 */
export function buildFileProjectMap(
  filePaths: string[],
  projects: CsprojInfo[],
): Map<string, CsprojInfo> {
  // Longest projectDir first so nested projects win over outer ones
  const sorted = [...projects].sort((a, b) => b.projectDir.length - a.projectDir.length)
  const map = new Map<string, CsprojInfo>()

  for (const filePath of filePaths) {
    for (const project of sorted) {
      if (filePath.startsWith(project.projectDir + '/') || filePath.startsWith(project.projectDir + '\\')) {
        map.set(filePath, project)
        break
      }
    }
  }

  return map
}
