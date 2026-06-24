import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Effective nullable context: each of annotations/warnings is enabled ('e'), disabled
// ('d'), or at the project default ('?', established by `restore` or before any directive).
type Flag = 'e' | 'd' | '?'
interface NullState { ann: Flag; warn: Flag }

/**
 * A <c>#nullable</c> directive that restates the context already in effect from an earlier
 * directive in the same file, so it changes nothing (IDE0240). Tracked file-locally: the
 * effective annotations/warnings state is replayed from every preceding <c>#nullable</c>
 * directive, and a directive whose effect equals that state is redundant. The first
 * <c>enable</c>/<c>disable</c> is never flagged (its relation to the project default is
 * unknown without the project context); only restatements of a state this file already set
 * — or a <c>restore</c> when nothing has changed the default — are reported, keeping it
 * false-positive free.
 */
export const csharpRedundantNullableDirectiveVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-nullable-directive',
  languages: ['csharp'],
  nodeTypes: ['preproc_nullable'],
  visit(node, filePath, sourceCode) {
    const directives = collectNullableDirectives(node.tree.rootNode)
    const index = directives.findIndex((d) => d.startIndex === node.startIndex)
    if (index < 0) return null

    let state: NullState = { ann: '?', warn: '?' }
    for (let i = 0; i < index; i++) {
      const prior = parseDirective(directives[i].text)
      if (prior) state = apply(state, prior)
    }

    const dir = parseDirective(node.text)
    if (dir === null) return null
    const next = apply(state, dir)
    if (next.ann !== state.ann || next.warn !== state.warn) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Redundant nullable directive',
      `This #nullable directive restates the nullable context already in effect, so it has no effect.`,
      sourceCode,
      'Remove the redundant #nullable directive.',
    )
  },
}

function collectNullableDirectives(root: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  const walk = (n: SyntaxNode | null) => {
    if (!n) return
    if (n.type === 'preproc_nullable') out.push(n)
    for (const c of n.namedChildren) walk(c)
  }
  walk(root)
  return out.sort((a, b) => a.startIndex - b.startIndex)
}

/** Parse `#nullable enable|disable|restore [annotations|warnings]`. */
function parseDirective(text: string): { value: Flag; scope: 'both' | 'ann' | 'warn' } | null {
  const m = text.replace(/^\s*#\s*nullable\s+/, '').trim().split(/\s+/)
  const action = m[0]
  const value: Flag = action === 'enable' ? 'e' : action === 'disable' ? 'd' : action === 'restore' ? '?' : '!' as Flag
  if (value === ('!' as Flag)) return null
  const scope = m[1] === 'annotations' ? 'ann' : m[1] === 'warnings' ? 'warn' : 'both'
  return { value, scope }
}

function apply(state: NullState, dir: { value: Flag; scope: 'both' | 'ann' | 'warn' }): NullState {
  return {
    ann: dir.scope === 'warn' ? state.ann : dir.value,
    warn: dir.scope === 'ann' ? state.warn : dir.value,
  }
}
