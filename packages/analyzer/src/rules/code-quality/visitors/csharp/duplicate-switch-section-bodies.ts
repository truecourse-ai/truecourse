import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Two switch sections whose statement bodies are identical should be merged
 * under stacked case labels. Keeping the body duplicated is a maintenance
 * hazard — a fix applied to one copy silently leaves the other stale. The body
 * is the section's statements with the leading `case`/`default` labels removed;
 * an empty body (a fall-through label) is excluded.
 */

function sectionBodyKey(section: SyntaxNode): string | null {
  // Keep statement/block nodes; drop the leading case/default/when labels.
  const body = section.namedChildren.filter((c) => c && /(statement|block)$/.test(c.type))
  if (body.length === 0) return null
  // Normalize whitespace so formatting differences don't mask a real duplicate.
  return body.map((n) => n!.text.replace(/\s+/g, ' ').trim()).join('\n')
}

export const csharpDuplicateSwitchSectionBodiesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/duplicate-switch-section-bodies',
  languages: ['csharp'],
  nodeTypes: ['switch_body'],
  visit(node, filePath, sourceCode) {
    const sections = node.namedChildren.filter((c) => c?.type === 'switch_section')
    if (sections.length < 2) return null

    const seen = new Map<string, SyntaxNode>()
    for (const section of sections) {
      if (!section) continue
      const key = sectionBodyKey(section)
      if (!key) continue
      // A lone `break;`/`return;` body is too trivial to be a meaningful
      // duplicate signal.
      if (/^(break|return|continue) ;$/.test(key)) continue
      const prior = seen.get(key)
      if (prior) {
        return makeViolation(
          this.ruleKey, section, filePath, 'low',
          'Duplicate switch section bodies',
          'This switch section has the same body as an earlier section; merge them under stacked case labels so the body lives in one place.',
          sourceCode,
          'Combine the sections by stacking their `case` labels above a single shared body.',
        )
      }
      seen.set(key, section)
    }
    return null
  },
}
