import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { indexRepoDocs, buildDocSectionIndex } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf } from './helpers.js'

const repos: string[] = []
const strays: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
  while (strays.length) rmrf(strays.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

function writeFile(root: string, rel: string, content: string): void {
  const target = path.join(root, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

describe('indexRepoDocs', () => {
  it('indexes the bound docs when there is no corpus', () => {
    const r = repo()
    writeFile(r, 'docs/a.md', '# A\nbody')
    const { indexes, missing } = indexRepoDocs(r, ['docs/a.md'])
    expect([...indexes.keys()]).toEqual(['docs/a.md'])
    expect(missing.size).toBe(0)
  })

  it('resolves a split spec’s external $refs end-to-end (ctx wiring, B6)', () => {
    const r = repo()
    // Split spec: entry references an external schema file up-and-down the tree.
    writeFile(
      r,
      'api/openapi.yaml',
      `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /todos:
    get:
      operationId: listTodos
      responses:
        '200':
          description: ok
          content: { application/json: { schema: { $ref: './schemas/todo.yaml' } } }
`,
    )
    writeFile(r, 'api/schemas/todo.yaml', 'type: object\nproperties: { id: { type: string } }\n')

    const { indexes } = indexRepoDocs(r, ['api/openapi.yaml'])
    const section = indexes.get('api/openapi.yaml')!.sections[0]

    // The section's fingerprint must equal the bundled equivalent's — proving the
    // external body was inlined before fingerprinting (run and generate agree).
    const bundled = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /todos:
    get:
      operationId: listTodos
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { type: object, properties: { id: { type: string } } }
`
    const bundledFp = buildDocSectionIndex('api/openapi.yaml', bundled).sections[0].fingerprint
    expect(section.fingerprint).toBe(bundledFp)
  })

  it('never inlines an in-repo symlink pointing OUTSIDE the repo (symlink escape, B6)', () => {
    const r = repo()
    // A secret file living outside the repo tree.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-outside-'))
    strays.push(outside)
    fs.writeFileSync(path.join(outside, 'secret.yaml'), 'type: object\nproperties: { leaked: { type: string } }\n')

    writeFile(
      r,
      'api/openapi.yaml',
      `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /todos:
    get:
      operationId: listTodos
      responses:
        '200':
          description: ok
          content: { application/json: { schema: { $ref: './secret.yaml' } } }
`,
    )
    // An in-repo symlink whose lexical path is inside the repo but whose target escapes.
    fs.symlinkSync(path.join(outside, 'secret.yaml'), path.join(r, 'api', 'secret.yaml'))

    const { indexes } = indexRepoDocs(r, ['api/openapi.yaml'])
    const text = indexes.get('api/openapi.yaml')!.sections[0].fingerprint
    const canonical = JSON.stringify(
      // Re-derive the section text to inspect it (fingerprint is opaque); assert the
      // schema stayed a literal $ref and the outside content never leaked in.
      indexes.get('api/openapi.yaml')!.sections[0],
    )
    expect(text).toBeTruthy()
    expect(canonical).not.toContain('leaked')

    // Byte-identity check: resolving must equal the DEGRADED (literal-$ref) form,
    // i.e. identical to a repo with the same entry but a dangling ref.
    const r2 = repo()
    writeFile(r2, 'api/openapi.yaml', fs.readFileSync(path.join(r, 'api', 'openapi.yaml'), 'utf-8'))
    const degraded = indexRepoDocs(r2, ['api/openapi.yaml']).indexes.get('api/openapi.yaml')!.sections[0].fingerprint
    expect(text).toBe(degraded)
  })

  it('still resolves an in-repo symlink pointing to an in-repo file', () => {
    const r = repo()
    writeFile(
      r,
      'api/openapi.yaml',
      `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /todos:
    get:
      operationId: listTodos
      responses:
        '200':
          description: ok
          content: { application/json: { schema: { $ref: './link.yaml' } } }
`,
    )
    writeFile(r, 'api/schemas/real.yaml', 'type: object\nproperties: { ok: { type: string } }\n')
    fs.symlinkSync(path.join(r, 'api', 'schemas', 'real.yaml'), path.join(r, 'api', 'link.yaml'))

    const { indexes } = indexRepoDocs(r, ['api/openapi.yaml'])
    const bundled = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /todos:
    get:
      operationId: listTodos
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { type: object, properties: { ok: { type: string } } }
`
    const bundledFp = buildDocSectionIndex('api/openapi.yaml', bundled).sections[0].fingerprint
    expect(indexes.get('api/openapi.yaml')!.sections[0].fingerprint).toBe(bundledFp)
  })

  it('records a bound doc that is missing on disk', () => {
    const r = repo()
    const { indexes, missing } = indexRepoDocs(r, ['docs/ghost.md'])
    expect(indexes.size).toBe(0)
    expect([...missing]).toEqual(['docs/ghost.md'])
  })

  it('unions corpus-kept docs with the bound docs', () => {
    const r = repo()
    writeFile(r, 'docs/a.md', '# A\nbody')
    writeFile(r, 'docs/b.md', '# B\nbody')
    writeFile(
      r,
      '.truecourse/specs/corpus.json',
      JSON.stringify({ version: 3, docs: [{ ref: 'docs/b.md' }] }),
    )
    const { indexes } = indexRepoDocs(r, ['docs/a.md'])
    expect([...indexes.keys()].sort()).toEqual(['docs/a.md', 'docs/b.md'])
  })

  it('marks a corpus-kept doc that is absent on disk as missing', () => {
    const r = repo()
    writeFile(
      r,
      '.truecourse/specs/corpus.json',
      JSON.stringify({ version: 3, docs: [{ ref: 'docs/vanished.md' }] }),
    )
    const { indexes, missing } = indexRepoDocs(r, [])
    expect(indexes.size).toBe(0)
    expect([...missing]).toEqual(['docs/vanished.md'])
  })
})
