import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createSpecExtractionManifest,
  discoverSpecFiles,
  parseMarkdownSpec,
  parseTextSpec,
} from '../../packages/analyzer/src/spec-discovery'

const tempDirs: string[] = []

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'truecourse-specs-'))
  tempDirs.push(dir)
  return dir
}

function writeFixture(root: string, relPath: string, content: string): void {
  const fullPath = join(root, relPath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, content)
}

function rel(root: string, files: string[]): string[] {
  return files.map((file) => relative(root, file).replace(/\\/g, '/'))
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('discoverSpecFiles', () => {
  it('discovers default prose spec globs in deterministic normalized order', () => {
    const root = tempProject()

    writeFixture(root, 'specs/flow.mdx', '# Flow\n')
    writeFixture(root, 'docs/api.md', '# API\n')
    writeFixture(root, 'requirements/auth.txt', 'Auth\n')
    writeFixture(root, 'rfcs/001-cache.md', '# Cache\n')
    writeFixture(root, 'adr/0001-storage.md', '# Storage\n')
    writeFixture(root, 'feature.spec.md', '# Feature\n')
    writeFixture(root, 'release.prd.md', '# Release\n')
    writeFixture(root, 'billing.requirements.md', '# Billing\n')
    writeFixture(root, 'docs/image.png', 'not a prose spec')

    expect(rel(root, discoverSpecFiles(root))).toEqual([
      'adr/0001-storage.md',
      'billing.requirements.md',
      'docs/api.md',
      'feature.spec.md',
      'release.prd.md',
      'requirements/auth.txt',
      'rfcs/001-cache.md',
      'specs/flow.mdx',
    ])
  })

  it('excludes ignored repo directories and configured excludes', () => {
    const root = tempProject()

    writeFixture(root, 'docs/visible.md', '# Visible\n')
    writeFixture(root, '.git/docs/hidden.md', '# Hidden\n')
    writeFixture(root, '.truecourse/docs/hidden.md', '# Hidden\n')
    writeFixture(root, 'node_modules/pkg/docs/hidden.md', '# Hidden\n')
    writeFixture(root, 'docs/private/hidden.md', '# Hidden\n')

    expect(rel(root, discoverSpecFiles(root, { excludeGlobs: ['docs/private/**'] }))).toEqual([
      'docs/visible.md',
    ])
  })

  it('honors configured include globs without falling back to default includes', () => {
    const root = tempProject()

    writeFixture(root, 'docs/default.md', '# Default\n')
    writeFixture(root, 'product/public.txt', 'Public requirement\n')
    writeFixture(root, 'product/private.txt', 'Private requirement\n')

    expect(rel(root, discoverSpecFiles(root, {
      specGlobs: ['product/**/*.txt'],
      excludeGlobs: ['product/private.txt'],
    }))).toEqual(['product/public.txt'])
  })
})

describe('parseMarkdownSpec', () => {
  const markdown = [
    '# Checkout',
    '',
    'Intro copy.',
    '## Authentication',
    '',
    '- Users must sign in.',
    '- Admins may export reports.',
    '',
    '```ts',
    '# not a heading inside code',
    'const ok = true',
    '```',
    '',
    '### Tokens',
    '',
    'Tokens should expire.',
    '',
    '## Billing',
    '',
    'The checkout route must exist.',
  ].join('\n')

  it('chunks Markdown by heading sections with source ranges', () => {
    const chunks = parseMarkdownSpec('docs/checkout.md', markdown)

    expect(chunks.map((chunk) => ({
      headingPath: chunk.headingPath,
      range: chunk.sourceRange,
    }))).toEqual([
      { headingPath: ['Checkout'], range: { startLine: 1, endLine: 20 } },
      { headingPath: ['Checkout', 'Authentication'], range: { startLine: 4, endLine: 16 } },
      { headingPath: ['Checkout', 'Authentication', 'Tokens'], range: { startLine: 14, endLine: 16 } },
      { headingPath: ['Checkout', 'Billing'], range: { startLine: 18, endLine: 20 } },
    ])
  })

  it('keeps lists and fenced code inside the owning section', () => {
    const authChunk = parseMarkdownSpec('docs/checkout.md', markdown)
      .find((chunk) => chunk.headingPath.join(' > ') === 'Checkout > Authentication')

    expect(authChunk?.text).toContain('- Users must sign in.')
    expect(authChunk?.text).toContain('```ts')
    expect(authChunk?.text).toContain('# not a heading inside code')
    expect(authChunk?.sourceRange).toEqual({ startLine: 4, endLine: 16 })
  })

  it('produces stable chunk IDs and hashes across repeated parses', () => {
    const first = parseMarkdownSpec('docs/checkout.md', markdown)
    const second = parseMarkdownSpec('docs/checkout.md', markdown)

    expect(first.map((chunk) => chunk.id)).toEqual(second.map((chunk) => chunk.id))
    expect(first.map((chunk) => chunk.hash)).toEqual(second.map((chunk) => chunk.hash))
  })
})

describe('parseTextSpec', () => {
  it('chunks plain text by heading-like boundaries', () => {
    const chunks = parseTextSpec('requirements/auth.txt', [
      'Authentication:',
      'Users must sign in.',
      '',
      'BILLING',
      'Checkout must collect payment.',
    ].join('\n'))

    expect(chunks.map((chunk) => ({
      headingPath: chunk.headingPath,
      range: chunk.sourceRange,
    }))).toEqual([
      { headingPath: ['Authentication'], range: { startLine: 1, endLine: 2 } },
      { headingPath: ['BILLING'], range: { startLine: 4, endLine: 5 } },
    ])
  })

  it('falls back to paragraph chunks when no heading-like boundaries exist', () => {
    const chunks = parseTextSpec('requirements/auth.txt', [
      'Users must sign in.',
      '',
      'Admins should approve exports.',
    ].join('\n'))

    expect(chunks.map((chunk) => chunk.sourceRange)).toEqual([
      { startLine: 1, endLine: 1 },
      { startLine: 3, endLine: 3 },
    ])
  })
})

describe('createSpecExtractionManifest', () => {
  it('returns a stable manifest sorted by normalized spec path', () => {
    const root = tempProject()
    writeFixture(root, 'specs/zeta.md', '# Zeta\n')
    writeFixture(root, 'docs/alpha.md', '# Alpha\n')

    const first = createSpecExtractionManifest(root)
    const second = createSpecExtractionManifest(root)

    expect(first).toEqual(second)
    expect(first.files.map((file) => file.path)).toEqual(['docs/alpha.md', 'specs/zeta.md'])
    expect(first.files.every((file) => file.status === 'parsed')).toBe(true)
    expect(first.files.flatMap((file) => file.chunks).every((chunk) => chunk.sourceFile.length > 0)).toBe(true)
  })

  it('extracts deterministic OpenAPI route requirements from YAML specs', () => {
    const root = tempProject()
    writeFixture(root, 'docs/openapi.yaml', [
      'openapi: 3.1.0',
      'info:',
      '  title: Billing API',
      '  version: 1.0.0',
      'security:',
      '  - bearerAuth: []',
      'paths:',
      '  /api/billing/checkout:',
      '    post:',
      '      summary: Create checkout session',
      '      requestBody:',
      '        content:',
      '          application/json:',
      '            schema:',
      '              $ref: "#/components/schemas/CheckoutRequest"',
      '      responses:',
      '        "201":',
      '          description: Created',
      '          content:',
      '            application/json:',
      '              schema:',
      '                $ref: "#/components/schemas/CheckoutResponse"',
      'components:',
      '  schemas:',
      '    CheckoutRequest:',
      '      type: object',
      '    CheckoutResponse:',
      '      type: object',
    ].join('\n'))

    const manifest = createSpecExtractionManifest(root)
    const file = manifest.files.find((entry) => entry.path === 'docs/openapi.yaml')
    const requirement = file?.requirements[0]

    expect(file?.status).toBe('parsed')
    expect(requirement?.kind).toBe('api')
    expect(requirement?.object).toBe('POST /api/billing/checkout')
    expect(requirement?.sourceRange).toEqual({ startLine: 9, endLine: 9 })
    expect(requirement?.constraints.map((constraint) => constraint.type)).toEqual([
      'statusCode',
      'requestSchema',
      'responseSchema',
      'auth',
      'securityScheme',
    ])
    expect(requirement?.id).toMatch(/^req_[a-f0-9]{12}$/)
  })

  it('extracts deterministic requirements from known JSON requirement specs', () => {
    const root = tempProject()
    writeFixture(root, 'docs/product.requirements.json', JSON.stringify({
      requirements: [
        {
          kind: 'auth',
          modality: 'must',
          subject: 'admin exports',
          action: 'require',
          object: 'admin role',
          evidenceText: 'Admin exports must require the admin role.',
          constraints: [{ type: 'role', value: 'admin' }],
        },
      ],
    }, null, 2))

    const manifest = createSpecExtractionManifest(root)
    const file = manifest.files.find((entry) => entry.path === 'docs/product.requirements.json')

    expect(file?.status).toBe('parsed')
    expect(file?.requirements).toHaveLength(1)
    expect(file?.requirements[0]).toMatchObject({
      kind: 'auth',
      modality: 'must',
      subject: 'admin exports',
      action: 'require',
      object: 'admin role',
      evidenceText: 'Admin exports must require the admin role.',
    })
  })

  it('marks unsupported structured specs without crashing', () => {
    const root = tempProject()
    writeFixture(root, 'docs/random.json', JSON.stringify({ name: 'not a requirement spec' }, null, 2))

    const manifest = createSpecExtractionManifest(root)
    const file = manifest.files.find((entry) => entry.path === 'docs/random.json')

    expect(file?.status).toBe('unsupported')
    expect(file?.requirements).toEqual([])
    expect(file?.error).toBeUndefined()
  })

  it('marks malformed JSON and YAML specs without crashing', () => {
    const root = tempProject()
    writeFixture(root, 'docs/bad.json', '{ "openapi": ')
    writeFixture(root, 'docs/bad.yaml', 'openapi: 3.1.0\npaths:\n  /broken:\n    get: [')

    const manifest = createSpecExtractionManifest(root)
    const badJson = manifest.files.find((entry) => entry.path === 'docs/bad.json')
    const badYaml = manifest.files.find((entry) => entry.path === 'docs/bad.yaml')

    expect(badJson?.status).toBe('malformed')
    expect(badJson?.requirements).toEqual([])
    expect(badJson?.error).toBeTruthy()
    expect(badJson?.hash).toMatch(/^[a-f0-9]{64}$/)

    expect(badYaml?.status).toBe('malformed')
    expect(badYaml?.requirements).toEqual([])
    expect(badYaml?.error).toBeTruthy()
    expect(badYaml?.hash).toMatch(/^[a-f0-9]{64}$/)
  })
})
