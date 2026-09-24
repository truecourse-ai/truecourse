/**
 * THE DOMAIN FILES — what the seed reads to know what a product can hold,
 * found by each ORM's own declaration wherever a project keeps it.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverDomainFiles, domainFingerprint } from '@truecourse/guard-generator'

const repos: string[] = []
afterEach(() => {
  while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true })
})

function repo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-seed-domain-'))
  repos.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), content)
  }
  return dir
}

const DRIZZLE = "import { pgTable, text } from 'drizzle-orm/pg-core'\nexport const links = pgTable('links', { id: text('id') })\n"

describe('discoverDomainFiles', () => {
  it('finds prisma schemas, ORM model declarations and SQL migrations, each with its kind', () => {
    const r = repo({
      'packages/prisma/schema.prisma': 'model Link { id Int @id }\n',
      'packages/prisma/migrations/20240101_init/migration.sql': 'CREATE TABLE "Link" (id int);\n',
      'src/db/tables.ts': DRIZZLE,
      'src/entities/user.ts': "import { Entity, Column } from 'typeorm'\n@Entity()\nexport class User { @Column() name!: string }\n",
      'src/models/tag.js': "const { DataTypes } = require('sequelize')\nmodule.exports = (sequelize) => sequelize.define('Tag', { name: DataTypes.STRING })\n",
      'db/schema.sql': 'CREATE TABLE tag (id int);\n',
    })
    expect(discoverDomainFiles(r).map(({ path, kind }) => [path, kind])).toEqual([
      ['db/schema.sql', 'migration'],
      ['packages/prisma/migrations/20240101_init/migration.sql', 'migration'],
      ['packages/prisma/schema.prisma', 'prisma'],
      ['src/db/tables.ts', 'drizzle'],
      ['src/entities/user.ts', 'typeorm'],
      ['src/models/tag.js', 'sequelize'],
    ])
  })

  it('skips dependencies, tests, UI modules, and files that only mention an ORM', () => {
    const r = repo({
      'node_modules/dep/schema.prisma': 'model X { id Int @id }\n',
      'tests/fixtures/schema.prisma': 'model Y { id Int @id }\n',
      'src/db/tables.test.ts': DRIZZLE,
      'src/components/Table.tsx': DRIZZLE,
      'src/queries.ts': "import { eq } from 'drizzle-orm'\nexport const byId = (id: string) => eq(links.id, id)\n",
      'src/sql/report.sql': 'SELECT 1;\n',
    })
    expect(discoverDomainFiles(r)).toEqual([])
  })

  it('fingerprints the files by content: an edit moves it, an unrelated file does not', () => {
    const r = repo({ 'prisma/schema.prisma': 'model Link { id Int @id }\n' })
    const before = domainFingerprint(discoverDomainFiles(r))
    fs.writeFileSync(path.join(r, 'README.md'), '# hi\n')
    expect(domainFingerprint(discoverDomainFiles(r))).toBe(before)
    fs.writeFileSync(path.join(r, 'prisma/schema.prisma'), 'model Link { id Int @id\n pinned Boolean }\n')
    expect(domainFingerprint(discoverDomainFiles(r))).not.toBe(before)
  })
})
