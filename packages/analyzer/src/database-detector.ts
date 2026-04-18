import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import type { FileAnalysis, DatabaseType, DatabaseInfo, DatabaseConnectionInfo, DatabaseDetectionResult, TableInfo, RelationInfo } from '@truecourse/shared'
import { DATABASE_IMPORT_MAP, DOCKER_IMAGE_MAP } from './patterns/database-patterns.js'
import { parsePrismaSchema } from './schema-parsers/prisma.js'
import { SCHEMA_PARSERS } from './schema-parsers/registry.js'
import type { Service } from './service-detector.js'

interface DetectedDatabase {
  type: DatabaseType
  driver: string
  serviceName: string
  connectionEnvVar?: string
}

/**
 * Detect databases used in the codebase by scanning imports, schema files,
 * and Docker Compose configuration.
 */
export function detectDatabases(
  rootPath: string,
  analyses: FileAnalysis[],
  services: Service[],
): DatabaseDetectionResult {
  const detections: DetectedDatabase[] = []

  // 1. Scan imports for database drivers/ORMs
  for (const analysis of analyses) {
    const service = services.find((s) => s.files.includes(analysis.filePath))
    if (!service) continue

    for (const imp of analysis.imports) {
      const dbMatch = DATABASE_IMPORT_MAP[imp.source]
      if (dbMatch) {
        detections.push({
          type: dbMatch.type,
          driver: dbMatch.driver,
          serviceName: service.name,
        })
      }
    }
  }

  // 2. Parse Docker Compose for database services
  const dockerDatabases = parseDockerCompose(rootPath)

  // 3. Deduplicate and build database instances
  // Group detections by type → database instance
  const dbByType = new Map<DatabaseType, { drivers: Set<string>; services: Set<string> }>()
  for (const det of detections) {
    if (!dbByType.has(det.type)) {
      dbByType.set(det.type, { drivers: new Set(), services: new Set() })
    }
    const entry = dbByType.get(det.type)!
    entry.drivers.add(det.driver)
    entry.services.add(det.serviceName)
  }

  // Add Docker Compose databases even if no imports detected
  for (const dockerDb of dockerDatabases) {
    if (!dbByType.has(dockerDb.type)) {
      dbByType.set(dockerDb.type, { drivers: new Set(), services: new Set() })
    }
    // Docker doesn't tell us which service connects, but we know the DB exists
  }

  // 4. Parse schema files for table/relation info
  const schemaResults = new Map<DatabaseType, { tables: TableInfo[]; relations: RelationInfo[] }>()

  // Prisma schemas
  const prismaFiles = findFiles(rootPath, 'schema.prisma', ['node_modules', '.git', 'dist'])
  for (const prismaFile of prismaFiles) {
    const content = readFileSync(prismaFile, 'utf-8')
    const result = parsePrismaSchema(content)

    // Detect actual DB type from datasource block
    let dbType: DatabaseType = 'postgres'
    const providerMatch = content.match(/provider\s*=\s*"(\w+)"/)
    if (providerMatch) {
      const provider = providerMatch[1]!
      if (provider === 'mysql') dbType = 'mysql'
      else if (provider === 'sqlite') dbType = 'sqlite'
      else if (provider === 'mongodb') dbType = 'mongodb'
    }

    // Update the type for prisma detections
    for (const [type, entry] of dbByType.entries()) {
      if (entry.drivers.has('prisma') && type !== dbType) {
        // Move prisma entries to the correct type
        const newEntry = dbByType.get(dbType) || { drivers: new Set<string>(), services: new Set<string>() }
        for (const d of entry.drivers) newEntry.drivers.add(d)
        for (const s of entry.services) newEntry.services.add(s)
        dbByType.set(dbType, newEntry)
        entry.drivers.delete('prisma')
        if (entry.drivers.size === 0 && entry.services.size === 0) {
          dbByType.delete(type)
        }
        break
      }
    }

    const existing = schemaResults.get(dbType) || { tables: [], relations: [] }
    existing.tables.push(...result.tables)
    existing.relations.push(...result.relations)
    schemaResults.set(dbType, existing)
  }

  // Import-based schema parsers (Drizzle, SQLAlchemy, etc.)
  for (const analysis of analyses) {
    for (const parser of SCHEMA_PARSERS) {
      if (!parser.matchesImport(analysis)) continue

      try {
        const content = readFileSync(resolve(analysis.filePath), 'utf-8')
        if (parser.validateContent && !parser.validateContent(content)) continue

        const result = parser.parse(content)
        if (result.tables.length === 0) continue

        const dbType = parser.detectDbType(content)
        const existing = schemaResults.get(dbType) || { tables: [], relations: [] }
        existing.tables.push(...result.tables)
        existing.relations.push(...result.relations)
        schemaResults.set(dbType, existing)
      } catch {
        // Skip files that can't be read
      }

      break // One parser match per file is enough
    }
  }

  // 5. Build final result
  const databases: DatabaseInfo[] = []
  const connections: DatabaseConnectionInfo[] = []

  for (const [type, entry] of dbByType.entries()) {
    const dockerDb = dockerDatabases.find((d) => d.type === type)
    const name = dockerDb?.name || type
    const driver = Array.from(entry.drivers)[0] || type
    const schema = schemaResults.get(type)

    databases.push({
      name,
      type,
      driver,
      tables: schema?.tables || [],
      relations: schema?.relations || [],
      connectedServices: Array.from(entry.services),
    })

    for (const serviceName of entry.services) {
      const svcDrivers = detections
        .filter((d) => d.serviceName === serviceName && d.type === type)
        .map((d) => d.driver)
      const svcDriver = svcDrivers[0] || driver

      connections.push({
        serviceName,
        databaseName: name,
        driver: svcDriver,
      })
    }
  }

  return { databases, connections }
}

/**
 * Parse docker-compose.yml for database services.
 */
export function parseDockerCompose(rootPath: string): { name: string; type: DatabaseType }[] {
  const results: { name: string; type: DatabaseType }[] = []

  const composeFiles = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
  let composeContent: string | null = null

  for (const file of composeFiles) {
    const filePath = join(rootPath, file)
    if (existsSync(filePath)) {
      composeContent = readFileSync(filePath, 'utf-8')
      break
    }
  }

  if (!composeContent) return results

  // Simple YAML parsing for Docker Compose services
  // Look for service definitions with image: xxx
  const lines = composeContent.split('\n')
  let currentService: string | null = null
  let inServices = false
  let servicesIndent = -1

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    const indent = rawLine.length - rawLine.trimStart().length

    // Detect 'services:' top-level key
    if (trimmed === 'services:') {
      inServices = true
      servicesIndent = indent
      continue
    }

    if (!inServices) continue

    // If we hit another top-level key at same or lower indent, stop
    if (indent <= servicesIndent && trimmed !== '' && !trimmed.startsWith('#')) {
      if (trimmed.endsWith(':') && !trimmed.includes(' ')) {
        inServices = false
        continue
      }
    }

    // Detect service name (next level indent)
    if (indent === servicesIndent + 2 && trimmed.endsWith(':') && !trimmed.includes(' ')) {
      currentService = trimmed.slice(0, -1)
      continue
    }

    // Detect image: inside a service
    if (currentService && trimmed.startsWith('image:')) {
      const imageValue = trimmed.slice(6).trim().replace(/['"]/g, '')
      // Extract base image name (before :tag)
      const baseImage = imageValue.split(':')[0]!.split('/').pop()!

      const dbType = DOCKER_IMAGE_MAP[baseImage]
      if (dbType) {
        results.push({ name: currentService, type: dbType })
      }
    }
  }

  return results
}

/**
 * Recursively find files with a given name, ignoring specified directories.
 */
function findFiles(dir: string, fileName: string, ignoreDirs: string[]): string[] {
  const results: string[] = []
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (ignoreDirs.includes(entry.name)) continue
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...findFiles(fullPath, fileName, ignoreDirs))
      } else if (entry.name === fileName) {
        results.push(fullPath)
      }
    }
  } catch {
    // Skip directories we can't read
  }
  return results
}
