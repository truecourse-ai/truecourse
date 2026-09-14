import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionTool, ToolContext } from '@truecourse/agent-loop'
import { readFileTool, readFilesTool, searchTool } from '../../packages/core/src/services/agent/repo-tools'
import { MAX_SOURCE_RESULT_BYTES, sourceLines, sourceView } from '../../packages/core/src/services/agent/source-view'

let repo: string
const ctx: ToolContext = { workItem: 'test', signal: new AbortController().signal, dispatchChild: async () => { throw new Error('unused') } }
const call = (tool: SessionTool, args: unknown) => tool.execute(tool.inputSchema.parse(args), ctx)
beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-source-')) })
afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }) })
const write = (text: string) => fs.writeFileSync(path.join(repo, 'view.tsx'), text)

describe('recoverable source', () => {
  it('retains late controls and indentation on long JSX lines', async () => {
    write(`  ${' '.repeat(800)}<button>Delete expense</button>`)
    const result = await call(readFileTool(repo), { path: 'view.tsx' })
    expect(result.content).toContain(`1\t  ${' '.repeat(800)}<button>Delete expense</button>`)
    expect(result.content).toContain('End of source.')
  })

  it.each(['abc ', '🙂界é'])('reconstructs a large line exactly with code-point continuations (%s)', async (unit) => {
    const text = unit.repeat(20_000) + '<button>Save</button>'
    write(text)
    let position = { start: 1, startColumn: 1 }
    let reconstructed = ''
    for (let page = 0; page < 100; page++) {
      const result = await call(readFileTool(repo), { path: 'view.tsx', ...position })
      expect(result.isError).toBeUndefined()
      expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(MAX_SOURCE_RESULT_BYTES)
      const row = result.content.split('\n')[1]
      reconstructed += row.slice(row.indexOf('\t') + 1)
      const match = result.content.match(/Continue with read_file\((.*)\)$/)
      if (!match) break
      const next = JSON.parse(match[1])
      expect(next.startColumn).toBeGreaterThan(position.startColumn)
      position = next
    }
    expect(reconstructed).toBe(text)
  })

  it('resumes subsequent lines at column one and normalizes CRLF', async () => {
    write('  abc🙂\r\n  second\r\n')
    const result = await call(readFileTool(repo), { path: 'view.tsx', startColumn: 4 })
    expect(result.content).toContain('1:4\tbc🙂\n2\t  second\n3\t')
    expect(result.content).not.toContain('\r')
  })

  it('pages at 400 lines and handles empty files', async () => {
    write(Array.from({ length: 401 }, () => 'x').join('\n'))
    expect((await call(readFileTool(repo), { path: 'view.tsx', lines: 1_000 })).content).toContain('"start":401,"startColumn":1')
    write('')
    expect((await call(readFileTool(repo), { path: 'view.tsx' })).content).toContain('1\t\nEnd of source.')
  })

  it('rejects out-of-range columns, lines, binary files and oversized files', async () => {
    write('abc')
    for (const args of [{ start: 2 }, { startColumn: 5 }]) {
      expect((await call(readFileTool(repo), { path: 'view.tsx', ...args })).isError).toBe(true)
    }
    write('a\0b')
    expect((await call(readFileTool(repo), { path: 'view.tsx' })).isError).toBe(true)
    write('x'.repeat(2_000_001))
    expect((await call(readFileTool(repo), { path: 'view.tsx' })).content).toContain('too large')
    expect((await call(readFileTool(repo), { path: '.', startColumn: 1 })).isError).toBe(true)
  })

  it('refuses lexical escapes and symlinks outside the repository', async () => {
    write('safe')
    fs.symlinkSync(os.tmpdir(), path.join(repo, 'outside'))
    for (const file of ['../elsewhere', 'outside']) {
      expect((await call(readFileTool(repo), { path: file })).content).toContain('outside the repository')
    }
    fs.symlinkSync(path.join(repo, 'view.tsx'), path.join(repo, 'inside.tsx'))
    expect((await call(readFileTool(repo), { path: 'inside.tsx' })).content).toContain('safe')
  })

  it('reports source ranges and rejects a budget too small to advance', () => {
    const view = sourceView({ path: 'view.tsx', lines: sourceLines('🙂'.repeat(200)), maxBytes: 350 })
    expect(view.complete).toBe(false)
    expect(view.next!.startColumn).toBe(view.ranges[0].endColumn)
    expect(() => sourceView({ path: 'view.tsx', lines: ['abc'], maxBytes: 5 })).toThrow('byte budget')
  })
})

describe('match-centered search', () => {
  it('shows late matches and a usable code-point position without trimming indentation', async () => {
    write('  ' + '🙂'.repeat(800) + '<button>Delete expense</button>')
    const result = await call(searchTool(repo), { query: 'Delete expense' })
    expect(result.content).toContain('view.tsx:1:811:')
    expect(result.content).toContain('<button>Delete expense</button>')
    const hint = JSON.parse(result.content.match(/read_file\((.*)\)/)![1])
    expect((await call(readFileTool(repo), hint)).content).toContain('Delete expense')
  })

  it('marks long matches partial and supports zero-width patterns', async () => {
    write('x'.repeat(800))
    expect((await call(searchTool(repo), { query: 'x{800}' })).content).toContain('[match continues]')
    expect((await call(searchTool(repo), { query: '^' })).content).toContain('view.tsx:1:1:')
    expect((await call(searchTool(repo), { query: '[' })).isError).toBe(true)
    expect((await call(searchTool(repo), { query: 'absent' })).content).toBe('No match for `absent`. Searched 1 text files.')
  })

  it('bounds hit count and Unicode response bytes and keeps hidden catalogs out of search', async () => {
    write(Array.from({ length: 100 }, () => '🙂'.repeat(400)).join('\n'))
    let result = await call(searchTool(repo), { query: '🙂' })
    expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(MAX_SOURCE_RESULT_BYTES)
    expect(result.content).toContain('additional matches omitted')
    write('hit\n'.repeat(100))
    result = await call(searchTool(repo), { query: 'hit' })
    expect(result.content.match(/read_file\(/g)).toHaveLength(60)
    fs.mkdirSync(path.join(repo, '.truecourse'))
    fs.writeFileSync(path.join(repo, '.truecourse', 'catalog.json'), 'hidden-only')
    expect((await call(searchTool(repo), { query: 'hidden-only' })).content).toContain('No match')
  })

  it('matches wildcard directories, braces, basenames and literal path filters independently', async () => {
    for (const file of ['packages/ui/dialog.tsx', 'packages/ui/nested/form.tsx', 'packages/ui/nested/table.ts', 'apps/editor.tsx']) {
      fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
      fs.writeFileSync(path.join(repo, file), 'export const Symbol = 1')
    }
    const search = searchTool(repo)
    const wild = await call(search, { query: 'Symbol', glob: 'packages/ui/**/*.tsx' })
    expect(wild.content).toContain('packages/ui/dialog.tsx:1:')
    expect(wild.content).toContain('packages/ui/nested/form.tsx:1:')
    expect(wild.content).not.toContain('table.ts')
    expect(wild.content).not.toContain('apps/editor')
    expect((await call(search, { query: 'Symbol', glob: '**/*.{ts,tsx}' })).content.match(/read_file\(/g)).toHaveLength(4)
    expect((await call(search, { query: 'Symbol', glob: '*.tsx' })).content.match(/read_file\(/g)).toHaveLength(3)
    expect((await call(search, { query: 'Symbol', glob: '**/*.tsx', pathContains: 'nested/' })).content.match(/read_file\(/g)).toHaveLength(1)
    expect((await call(search, { query: 'Symbol', pathContains: '.tsx' })).content.match(/read_file\(/g)).toHaveLength(3)
    expect((await call(search, { query: 'Symbol', glob: 'nothing/**/*.tsx' })).content).toContain('No files matched')
    expect((await call(search, { query: 'absent', glob: 'packages/ui/**/*.tsx' })).content).toContain('Searched 2 text files')
    expect((await call(search, { query: 'Symbol', glob: '../**/*.tsx' })).content).toContain('No files matched')
    fs.symlinkSync(os.tmpdir(), path.join(repo, 'outside'))
    expect((await call(search, { query: '.', glob: 'outside/**' })).content).toContain('No files matched')
  })

  it('distinguishes matched binary files from a content miss', async () => {
    write('a\0b')
    expect((await call(searchTool(repo), { query: 'a', glob: '*.tsx' })).content).toContain('none were searchable text files')
  })
})

describe('bounded independent source reads', () => {
  it('shares a byte budget and preserves exact continuations and per-file failures', async () => {
    write('🙂'.repeat(20_000))
    fs.writeFileSync(path.join(repo, 'other.ts'), 'export const Save = true')
    const result = await call(readFilesTool(repo), { files: [{ path: 'view.tsx' }, { path: 'other.ts' }, { path: '../outside' }] })
    expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(MAX_SOURCE_RESULT_BYTES)
    expect(result.content).toContain('export const Save = true')
    expect(result.content).toContain('outside the repository')
    const next = JSON.parse(result.content.match(/Continue with read_file\((.*)\)/)![1])
    expect(next.startColumn).toBeGreaterThan(1)
    const tail = await call(readFilesTool(repo), { files: [next] })
    expect(tail.content).toContain(`1:${next.startColumn}\t`)
    expect(readFilesTool(repo).inputSchema.safeParse({ files: Array.from({ length: 9 }, () => ({ path: 'view.tsx' })) }).success).toBe(false)
  })
})
