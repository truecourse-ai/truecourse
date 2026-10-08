/**
 * `nodeRefContext`: the filesystem-backed resolver context that inlines a split
 * OpenAPI spec's external `$ref`s. Resolving through it equals deriving the
 * bundled spec; an in-repo symlink whose target escapes the repo is never read,
 * so its `$ref` stays literal; an in-repo symlink to an in-repo file resolves.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deriveOpenApiSections } from '@truecourse/shared/openapi'
import { nodeRefContext } from '@truecourse/shared/openapi-node'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}
function writeFile(root: string, rel: string, content: string): void {
  const target = path.join(root, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

/** An entry spec whose one response schema is the external `ref`. */
const entry = (ref: string): string => `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /todos:
    get:
      operationId: listTodos
      responses:
        '200':
          description: ok
          content: { application/json: { schema: { $ref: '${ref}' } } }
`

/** The same spec with `schema` inlined. */
const bundled = (schema: string): string => `openapi: 3.0.3
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
              schema: ${schema}
`

/** The canonical text of a spec's one operation, resolved through the repo. */
function resolved(repo: string, doc: string): string {
  const content = fs.readFileSync(path.join(repo, doc), 'utf-8')
  return deriveOpenApiSections(content, nodeRefContext(repo, doc))[0]!.canonicalText
}

describe('nodeRefContext', () => {
  it('inlines a split spec’s external $ref, equal to the bundled spec', () => {
    const repo = tempDir('tc-ref-')
    writeFile(repo, 'api/openapi.yaml', entry('./schemas/todo.yaml'))
    writeFile(repo, 'api/schemas/todo.yaml', 'type: object\nproperties: { id: { type: string } }\n')
    const want = deriveOpenApiSections(bundled('{ type: object, properties: { id: { type: string } } }'))[0]!.canonicalText
    expect(resolved(repo, 'api/openapi.yaml')).toBe(want)
  })

  it('never reads an in-repo symlink whose target is outside the repo', () => {
    const outside = tempDir('tc-outside-')
    fs.writeFileSync(path.join(outside, 'secret.yaml'), 'type: object\nproperties: { leaked: { type: string } }\n')
    const repo = tempDir('tc-ref-')
    writeFile(repo, 'api/openapi.yaml', entry('./secret.yaml'))
    fs.symlinkSync(path.join(outside, 'secret.yaml'), path.join(repo, 'api', 'secret.yaml'))

    const text = resolved(repo, 'api/openapi.yaml')
    expect(text).not.toContain('leaked')
    // The same as a dangling ref: the $ref stays literal.
    const dangling = tempDir('tc-ref-')
    writeFile(dangling, 'api/openapi.yaml', entry('./secret.yaml'))
    expect(text).toBe(resolved(dangling, 'api/openapi.yaml'))
  })

  it('resolves an in-repo symlink to an in-repo file', () => {
    const repo = tempDir('tc-ref-')
    writeFile(repo, 'api/openapi.yaml', entry('./link.yaml'))
    writeFile(repo, 'api/schemas/real.yaml', 'type: object\nproperties: { ok: { type: string } }\n')
    fs.symlinkSync(path.join(repo, 'api', 'schemas', 'real.yaml'), path.join(repo, 'api', 'link.yaml'))
    const want = deriveOpenApiSections(bundled('{ type: object, properties: { ok: { type: string } } }'))[0]!.canonicalText
    expect(resolved(repo, 'api/openapi.yaml')).toBe(want)
  })
})
