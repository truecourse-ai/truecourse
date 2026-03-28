import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, basename, dirname } from 'path'
import type { ServiceType } from '@truecourse/shared'
import { serviceDetectionPatterns } from './patterns/service-patterns.js'
import { getAllPackageIndicatorFiles } from './language-config.js'
import { readAllDependencies, isLanguageLibrary } from './service-detectors/registry.js'

/**
 * Service detection result
 */
export interface Service {
  name: string
  rootPath: string
  entryPoint?: string | undefined
  type: ServiceType
  framework?: string | undefined
  port?: number | undefined
  files: string[] // Absolute paths of files in this service
}

/**
 * Detect all services in a codebase (monorepo or monolith)
 */
export function detectServices(rootPath: string, allFiles: string[]): Service[] {
  // 1. Check for monorepo structure
  const monorepoServices = detectMonorepoServices(rootPath, allFiles)
  if (monorepoServices.length > 0) {
    return monorepoServices
  }

  // 2. Check for multiple entry points (multi-service monolith)
  const entryPointServices = detectByEntryPoints(rootPath, allFiles)
  if (entryPointServices.length > 1) {
    return entryPointServices
  }

  // 3. Check Docker compose
  const dockerServices = detectDockerComposeServices(rootPath, allFiles)
  if (dockerServices.length > 0) {
    return dockerServices
  }

  // 4. Default: Single service (monolith)
  return [{
    name: getServiceName(rootPath),
    rootPath,
    type: detectServiceType(rootPath, allFiles),
    framework: detectFramework(rootPath),
    files: allFiles,
  }]
}

/**
 * Detect monorepo structure (packages/, services/, apps/)
 */
function detectMonorepoServices(rootPath: string, allFiles: string[]): Service[] {
  const services: Service[] = []
  const patterns = serviceDetectionPatterns

  // Check for monorepo config files
  const hasMonorepoConfig =
    existsSync(join(rootPath, 'pnpm-workspace.yaml')) ||
    existsSync(join(rootPath, 'lerna.json')) ||
    existsSync(join(rootPath, 'nx.json')) ||
    existsSync(join(rootPath, 'turbo.json'))

  if (!hasMonorepoConfig) {
    // Check for package directories
    let hasPackageDirs = false
    for (const pattern of patterns.monorepoPatterns) {
      const dirPath = join(rootPath, pattern)
      if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
        hasPackageDirs = true
        break
      }
    }

    if (!hasPackageDirs) {
      return []
    }
  }

  // Scan for service directories
  for (const pattern of patterns.monorepoPatterns) {
    const dirPath = join(rootPath, pattern)
    if (!existsSync(dirPath)) continue

    try {
      const entries = readdirSync(dirPath)
      for (const entry of entries) {
        const servicePath = join(dirPath, entry)
        const stats = statSync(servicePath)

        if (!stats.isDirectory()) continue

        // Check if this directory has any known package indicator file
        const hasPackageFile = getAllPackageIndicatorFiles().some(
          (f) => existsSync(join(servicePath, f))
        )

        if (hasPackageFile) {
          const serviceFiles = allFiles.filter(f => f.startsWith(servicePath))
          if (serviceFiles.length > 0) {
            services.push({
              name: entry,
              rootPath: servicePath,
              type: detectServiceType(servicePath, serviceFiles),
              framework: detectFramework(servicePath),
              files: serviceFiles,
            })
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  return services
}

/**
 * Detect services by multiple entry points
 */
function detectByEntryPoints(_rootPath: string, allFiles: string[]): Service[] {
  const patterns = serviceDetectionPatterns

  const entryPoints = allFiles.filter(file => {
    const baseName = basename(file)
    return patterns.entryPoints.includes(baseName)
  })

  if (entryPoints.length <= 1) {
    return []
  }

  // Group files by entry point directory
  const serviceMap = new Map<string, string[]>()

  for (const entry of entryPoints) {
    const dir = dirname(entry)
    serviceMap.set(dir, allFiles.filter(f => f.startsWith(dir)))
  }

  const services: Service[] = []
  for (const [dir, files] of serviceMap.entries()) {
    const dirName = basename(dir)
    const isSrcDir = patterns.commonSourceDirectories.includes(dirName)
    const serviceRoot = isSrcDir ? dirname(dir) : dir
    const name = isSrcDir ? basename(dirname(dir)) : dirName

    services.push({
      name,
      rootPath: dir,
      entryPoint: entryPoints.find(e => dirname(e) === dir),
      type: detectServiceType(serviceRoot, files),
      files,
    })
  }

  return services
}

/**
 * Detect services from Docker Compose file
 */
function detectDockerComposeServices(rootPath: string, allFiles: string[]): Service[] {
  const composeFiles = [
    'docker-compose.yml',
    'docker-compose.yaml',
    'compose.yml',
    'compose.yaml',
  ]

  let composePath: string | null = null
  for (const file of composeFiles) {
    const path = join(rootPath, file)
    if (existsSync(path)) {
      composePath = path
      break
    }
  }

  if (!composePath) {
    return []
  }

  try {
    const content = readFileSync(composePath, 'utf-8')
    const services: Service[] = []

    // Simple YAML parsing for service names (not a full YAML parser)
    const lines = content.split('\n')
    let inServices = false

    for (const line of lines) {
      if (line.trim() === 'services:') {
        inServices = true
        continue
      }

      if (inServices && line.match(/^  \w+:/)) {
        const serviceName = line.trim().replace(':', '')
        const servicePath = join(rootPath, serviceName)

        if (existsSync(servicePath) && statSync(servicePath).isDirectory()) {
          const serviceFiles = allFiles.filter(f => f.startsWith(servicePath))
          if (serviceFiles.length > 0) {
            services.push({
              name: serviceName,
              rootPath: servicePath,
              type: detectServiceType(servicePath, serviceFiles),
              files: serviceFiles,
            })
          }
        }
      }

      if (inServices && line.length > 0 && !line.startsWith(' ')) {
        inServices = false
      }
    }

    return services
  } catch (error) {
    return []
  }
}

/**
 * Detect service type based on files and structure
 */
function detectServiceType(
  servicePath: string,
  files: string[],
): ServiceType {
  const patterns = serviceDetectionPatterns
  const hasPackageJson = existsSync(join(servicePath, 'package.json'))

  // Check for frontend FIRST (before API indicators, since frontend may have "api" folders)
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(readFileSync(join(servicePath, 'package.json'), 'utf-8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }

      const isFrontend = patterns.frontend.frameworks.some(fw => deps[fw])
      if (isFrontend) {
        return 'frontend'
      }
    } catch (error) {
      // Ignore parse errors
    }
  }

  // Check for API frameworks
  const hasApiIndicators = files.some(f =>
    patterns.apiServer.fileIndicators.some(indicator => f.includes(indicator))
  )

  if (hasApiIndicators) {
    return 'api-server'
  }

  // Check for worker/background job patterns
  const hasWorkerIndicators = files.some(f =>
    patterns.worker.fileIndicators.some(indicator => f.includes(indicator))
  )

  if (hasWorkerIndicators) {
    return 'worker'
  }

  // Check if it's a library (language-agnostic — each language detector has its own heuristic)
  if (isLanguageLibrary(servicePath, files, hasApiIndicators, hasWorkerIndicators)) {
    if (!detectFramework(servicePath)) {
      return 'library'
    }
  }

  return 'unknown'
}

/**
 * Detect framework used by service
 */
function detectFramework(servicePath: string): string | undefined {
  const patterns = serviceDetectionPatterns
  const packageJsonPath = join(servicePath, 'package.json')

  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }

      // Check meta-frameworks first (priority order)
      for (const fw of patterns.metaFrameworks) {
        if (deps[fw]) {
          return fw
        }
      }

      // Check all other frameworks
      const allFrameworks = [
        ...patterns.apiServer.frameworks,
        ...patterns.frontend.frameworks,
        ...patterns.worker.frameworks,
      ]

      for (const fw of allFrameworks) {
        if (deps[fw] && !patterns.metaFrameworks.includes(fw)) {
          return fw
        }
      }
    } catch (error) {
      // Ignore parse errors
    }
  }

  // Check all language-specific dependency files for framework detection
  const deps = readAllDependencies(servicePath)
  if (deps.length > 0) {
    const allFrameworks = [
      ...patterns.apiServer.frameworks,
      ...patterns.worker.frameworks,
    ]

    for (const fw of allFrameworks) {
      if (deps.some((d) => d === fw || d.startsWith(fw + '['))) {
        return fw
      }
    }
  }

  return undefined
}

/**
 * Get service name from directory or package.json
 */
function getServiceName(servicePath: string): string {
  const packageJsonPath = join(servicePath, 'package.json')
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      if (pkg.name) {
        return pkg.name
      }
    } catch (error) {
      // Ignore parse errors
    }
  }

  return basename(servicePath)
}
