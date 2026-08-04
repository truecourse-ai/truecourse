import { describe, it, expect } from 'vitest'
import { countExtractViews, extractDocClaims } from '@truecourse/guard-generator'
import { buildDocSectionIndex, extractSectionTexts } from '@truecourse/guard-runner'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TODOS = `openapi: 3.0.3
info: { title: Todos, version: 1.0.0 }
paths:
  /todos:
    get:
      operationId: listTodos
      responses: { '200': { description: ok } }
    post:
      operationId: createTodo
      responses: { '201': { description: created } }
  /todos/{id}:
    get:
      operationId: getTodo
      responses: { '200': { description: ok } }
`

/** Build a GuardDoc-shaped object (doc/content/sections) from a doc's index. */
function guardDoc(docPath: string, content: string): {
  doc: string
  content: string
  sections: { anchor: string; fullText: string; headingText: string; level: number }[]
  suppressedQuotes: string[]
} {
  const idx = buildDocSectionIndex(docPath, content)
  const texts = extractSectionTexts(docPath, content)
  return {
    doc: docPath,
    content,
    sections: idx.sections.map((s) => ({
      anchor: s.anchor,
      fullText: texts.get(s.anchor)!.fullText,
      headingText: s.headingText,
      level: s.level,
    })),
    suppressedQuotes: [],
  }
}

describe('extract view planning — OpenAPI docs chunk by operation', () => {
  it('plans one extraction view per operation section', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(countExtractViews(guardDoc('api/openapi.yaml', TODOS) as any)).toBe(3)
  })

  it('a single-operation OpenAPI doc is one view', () => {
    const single = `openapi: 3.0.0
info: { title: x, version: '1' }
paths:
  /ping:
    get:
      operationId: ping
      responses: { '200': { description: ok } }
`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(countExtractViews(guardDoc('api/openapi.yaml', single) as any)).toBe(1)
  })

  it('extraction snaps api claims to their operation anchors, per-operation view', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-oa-extract-'))
    try {
      const gd = guardDoc('api/openapi.yaml', TODOS)
      // A runner that emits one api claim per view, bound to the view's own
      // operation (the outline lets it snap to any anchor; it picks the first).
      const seenViews: number[] = []
      const runner = async (ctx: {
        outline: { anchor: string }[]
        view?: { index: number; total: number }
      }): Promise<{ claims: unknown[]; untestable: unknown[] }> => {
        seenViews.push(ctx.view?.index ?? 1)
        // The view text is one operation; extract a claim onto every outline anchor
        // would be wrong — pick the anchor matching this view's index.
        const anchor = ctx.outline[(ctx.view?.index ?? 1) - 1].anchor
        return {
          claims: [{ claim: `${anchor} claim`, driver: 'api', sectionAnchor: anchor, reason: 'HTTP status' }],
          untestable: [],
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await extractDocClaims(repo, gd as any, runner as any)
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(seenViews.sort()).toEqual([1, 2, 3])
      expect(res.data.claims.map((c) => c.sectionAnchor).sort()).toEqual([
        'paths/get-gettodo',
        'paths/get-listtodos',
        'paths/post-createtodo',
      ])
      expect(res.data.claims.every((c) => c.driver === 'api')).toBe(true)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})
