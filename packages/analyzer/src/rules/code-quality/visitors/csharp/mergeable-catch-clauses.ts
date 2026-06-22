import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Within one `try`, two catch clauses whose handler bodies are byte-for-byte
 * identical duplicate the same handling for different exception types; they can
 * be combined into a single catch with an `or` pattern (or a common base type),
 * removing the maintenance hazard of two bodies drifting apart. The
 * check compares the normalized text of each catch clause's body block; on the
 * first later clause that matches an earlier one, it fires.
 *
 * Empty bodies (`catch { }`) and identical declarations are excluded — an empty
 * swallow is a different concern, and two catches of the *same* exception type
 * don't compile.
 */

function bodyText(clause: SyntaxNode): string | null {
  const block = clause.namedChildren.find((c) => c?.type === 'block')
  if (!block) return null
  const inner = block.namedChildren.filter(Boolean)
  if (inner.length === 0) return null // empty handler — not this rule's concern
  return inner.map((c) => c!.text.replace(/\s+/g, ' ').trim()).join(' ')
}

function declText(clause: SyntaxNode): string {
  return clause.namedChildren.find((c) => c?.type === 'catch_declaration')?.text.replace(/\s+/g, '') ?? ''
}

export const csharpMergeableCatchClausesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/mergeable-catch-clauses',
  languages: ['csharp'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    const catches = node.namedChildren.filter((c): c is SyntaxNode => c?.type === 'catch_clause')
    if (catches.length < 2) return null

    const seen: Array<{ body: string; decl: string }> = []
    for (const clause of catches) {
      // A `when` filter makes two same-bodied catches behave differently.
      if (clause.namedChildren.some((c) => c?.type === 'catch_filter_clause')) {
        seen.push({ body: `__filtered__${clause.id}`, decl: declText(clause) })
        continue
      }
      const body = bodyText(clause)
      if (body == null) {
        seen.push({ body: `__empty__${clause.id}`, decl: declText(clause) })
        continue
      }
      const decl = declText(clause)
      const dup = seen.find((s) => s.body === body && s.decl !== decl)
      if (dup) {
        return makeViolation(
          this.ruleKey, clause, filePath, 'low',
          'Mergeable catch clauses',
          'This catch clause has the same handler body as an earlier catch on the same `try`; combine them into one catch.',
          sourceCode,
          'Merge the duplicate catch clauses into a single catch using an `or` pattern or a common base exception type.',
        )
      }
      seen.push({ body, decl })
    }
    return null
  },
}
