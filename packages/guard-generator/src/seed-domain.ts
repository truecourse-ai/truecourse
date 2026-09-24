/**
 * THE DOMAIN — the files that say what a product can hold: its models, their
 * enums, flags and relations, its roles. The seed builds its coverage world
 * from them, so they are found deterministically and ORM-agnostically (a model
 * is recognised by the ORM's own declaration, not by where a project keeps it),
 * and their digests are folded into the seed step's settle and cache keys: a
 * schema change re-seeds.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DOC_DISCOVERY_SKIP_DIRS } from '@truecourse/shared'

/** What declares a domain file: an ORM's model form, or a migration. */
export type DomainFileKind =
  | 'prisma'
  | 'drizzle'
  | 'typeorm'
  | 'sequelize'
  | 'mongoose'
  | 'sqlalchemy'
  | 'django'
  | 'migration'

export interface DomainFile {
  /** Repo-relative, `/`-separated. */
  path: string
  kind: DomainFileKind
  /** A short digest of the file's content. */
  digest: string
}

/** Source extensions a model can be declared in. UI modules (`.tsx`/`.jsx`) never declare one. */
const MODEL_SOURCE = /\.(?:[cm]?[jt]s|py)$/
/** Test and type-only files declare no model the product holds. */
const NOT_A_MODEL = /\.(?:test|spec)\.[^.]+$|\.d\.[cm]?ts$/
/** Directories that hold tests, fixtures and examples: their models are not the product's. */
const NON_PRODUCT_DIRS = new Set(['test', 'tests', '__tests__', 'e2e', 'fixtures', '__fixtures__', '__mocks__', 'examples'])
/** A path segment naming a migrations directory. */
const MIGRATIONS_DIR = /^(?:migrations?|db-?migrations?|migrate)$/i
/** A whole-schema SQL dump, wherever it sits. */
const SQL_SCHEMA_FILE = /^(?:schema|structure|init|database)\.sql$/i

/** The largest file whose content is read for a model declaration. */
const MAX_SCAN_BYTES = 512 * 1024
/** How many entries the walk visits, and how many domain files it keeps. */
const MAX_WALK_ENTRIES = 60_000
const MAX_DOMAIN_FILES = 400

/**
 * Each ORM's model declaration, and (when the declaration alone is ambiguous)
 * the import that says the file uses that ORM.
 */
const MODEL_MARKERS: { kind: DomainFileKind; declares: RegExp; uses?: RegExp }[] = [
  { kind: 'drizzle', declares: /\b(?:pgTable|mysqlTable|sqliteTable)\s*\(/, uses: /drizzle-orm/ },
  { kind: 'typeorm', declares: /@Entity\s*\(/, uses: /['"]typeorm['"]/ },
  {
    kind: 'sequelize',
    declares: /\.define\s*\(\s*['"`]|\bModel\.init\s*\(|\.init\s*\(\s*\{|@Table\b/,
    uses: /['"]sequelize(?:-typescript)?['"]/,
  },
  { kind: 'mongoose', declares: /new\s+(?:mongoose\.)?Schema\s*[(<]/, uses: /['"]mongoose['"]/ },
  { kind: 'sqlalchemy', declares: /__tablename__\s*=/, uses: /\bsqlalchemy\b/ },
  { kind: 'django', declares: /\(\s*models\.Model\s*\)/, uses: /\bdjango\.db\b/ },
  // A knex (or similar query-builder) migration: the schema written as code.
  { kind: 'migration', declares: /\.schema\.(?:createTable|alterTable)\s*\(/ },
]

/**
 * Every domain file of the repository, sorted by path: `*.prisma` schemas,
 * source files that declare a model the way their ORM does (drizzle tables,
 * TypeORM entities, Sequelize and Mongoose models, SQLAlchemy and Django
 * models, query-builder migrations), and SQL files in a migrations directory
 * or named as a whole-schema dump. Build output, dependencies, tests and
 * fixtures are skipped.
 */
export function discoverDomainFiles(repoRoot: string): DomainFile[] {
  const found: DomainFile[] = []
  const stack = ['']
  let visited = 0
  while (stack.length > 0 && visited < MAX_WALK_ENTRIES && found.length < MAX_DOMAIN_FILES) {
    const rel = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(path.join(repoRoot, rel), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      visited += 1
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!DOC_DISCOVERY_SKIP_DIRS.has(entry.name) && !NON_PRODUCT_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          stack.push(childRel)
        }
        continue
      }
      if (!entry.isFile()) continue
      const kind = domainKind(repoRoot, childRel)
      if (kind) found.push({ path: childRel, kind, digest: fileDigest(path.join(repoRoot, childRel)) })
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path))
}

/** One digest over every domain file's path and content: what the seed's keys fold. */
export function domainFingerprint(files: readonly DomainFile[]): string {
  const hash = createHash('sha256').update('domain')
  for (const file of files) hash.update(`\n${file.path}\t${file.digest}`)
  return hash.digest('hex')
}

/** What kind of domain file `rel` is, or nothing when it declares no model. */
function domainKind(repoRoot: string, rel: string): DomainFileKind | undefined {
  const name = path.posix.basename(rel)
  if (name.endsWith('.prisma')) return 'prisma'
  if (name.endsWith('.sql')) {
    const inMigrations = rel.split('/').slice(0, -1).some((segment) => MIGRATIONS_DIR.test(segment))
    return inMigrations || SQL_SCHEMA_FILE.test(name) ? 'migration' : undefined
  }
  if (!MODEL_SOURCE.test(name) || NOT_A_MODEL.test(name)) return undefined
  const content = readSmall(path.join(repoRoot, rel))
  if (content === undefined) return undefined
  return MODEL_MARKERS.find((marker) => marker.declares.test(content) && (marker.uses?.test(content) ?? true))?.kind
}

function readSmall(abs: string): string | undefined {
  try {
    if (fs.statSync(abs).size > MAX_SCAN_BYTES) return undefined
    return fs.readFileSync(abs, 'utf-8')
  } catch {
    return undefined
  }
}

function fileDigest(abs: string): string {
  try {
    return createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 16)
  } catch {
    return 'unreadable'
  }
}
