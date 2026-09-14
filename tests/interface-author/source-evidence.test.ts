import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { sourceEvidence, sourceUnitView } from '../../packages/core/src/services/interface-author/source-evidence'
import { sourceLines, sourceView } from '../../packages/core/src/services/agent/source-view'

const editor = fs.readFileSync(path.resolve('tests/fixtures/interface-context/DocumentEditor.tsx'), 'utf8')

describe('source evidence bound to content', () => {
  it('reuses exact source evidence across paths, and invalidates same-size source edits', () => {
    const first = sourceEvidence('first.tsx', editor)
    expect(sourceEvidence('second.tsx', editor)).toBe(first)
    const modified = sourceEvidence('first.tsx', editor.replace('Save failed', 'Save denied'))
    expect(modified.hash).not.toBe(first.hash)
    expect(modified).not.toBe(first)
    expect(first.imports).toEqual(['react', './EditorDialog'])
    expect(first.units.find(unit => unit.name === 'DocumentEditor')).toMatchObject({ kind: 'declaration' })
    expect(Object.isFrozen(first.units)).toBe(true)
  })

  it('supplies a late editor whole while naming an oversized earlier unit and recovering every gap', () => {
    const source = `export const translations = ${JSON.stringify('translation '.repeat(2_000))}\n\n${editor}`
    const lines = sourceLines(source)
    const view = sourceUnitView('editor.tsx', source, 5_000)
    expect(view.complete).toBe(false)
    expect(view.content).toContain('Complete source units')
    expect(view.content).toContain('translations')
    expect(Buffer.byteLength(view.content)).toBeLessThanOrEqual(5_000)
    for (const behavior of ['Title is required', 'Save failed', 'Deletion failed', 'setDraft(record.title)', 'confirmDelete', 'setShowDelete(false)']) {
      expect(view.content).toContain(behavior)
    }
    const unit = view.units.find(unit => unit.name === 'DocumentEditor')!
    expect(unit).toBeDefined()
    expect(view.ranges.filter(range => range.line >= unit.start && range.line <= unit.end)).toHaveLength(unit.end - unit.start + 1)
    expect(view.omitted[0].start).toEqual({ start: 1, startColumn: 1 })
    // Recover all original code using the included ranges plus exact omitted spans.
    const recovered = lines.map(line => Array.from(line).map(() => false))
    for (const range of view.ranges) for (let column = range.startColumn - 1; column < range.endColumn - 1; column++) recovered[range.line - 1][column] = true
    for (const gap of view.omitted) {
      let position = gap.start
      while (position.start < gap.end.start || position.startColumn < gap.end.startColumn) {
        const page = sourceView({ path: 'editor.tsx', lines, ...position, maxBytes: 1_000 })
        for (const range of page.ranges) for (let column = range.startColumn - 1; column < range.endColumn - 1; column++) recovered[range.line - 1][column] = true
        if (!page.next) break
        position = page.next
      }
    }
    expect(recovered.every(line => line.every(Boolean))).toBe(true)
  })

  it('does not claim complete units for malformed or non-TS source', () => {
    for (const [file, source] of [['broken.tsx', 'export function Broken() { '.repeat(1_000)], ['component.vue', '<template>'.repeat(1_000)]]) {
      const view = sourceUnitView(file, source, 2_000)
      expect(view.content).not.toContain('Complete source units')
      expect(view.units).toEqual([])
      expect(view.next).toBeDefined()
      expect(view.omitted.length).toBeGreaterThan(0)
      expect(Buffer.byteLength(view.content)).toBeLessThanOrEqual(2_000)
    }
  })

  it('keeps same-line declarations together, including their trailing source', () => {
    const evidence = sourceEvidence('same.tsx', 'export const a = () => 1; export const b = () => 2;\nexport function c() { return 3 }')
    expect(evidence.units).toHaveLength(2)
    expect(evidence.units[0].name).toBe('a, b')
  })
})
