import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * Empty static constructor — the C# form of an empty `static { }` block.
 * Beyond being dead code, its presence disables the runtime's
 * `beforefieldinit` optimization for the whole type (CA1810 territory).
 */
export const csharpEmptyStaticBlockVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/empty-static-block',
  languages: ['csharp'],
  nodeTypes: ['constructor_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'static')) return null

    const body = node.childForFieldName('body')
      ?? node.namedChildren.find((c) => c?.type === 'block')
    if (!body || body.type !== 'block') return null
    // Comments are named children — a commented body is an intentional stub.
    if (body.namedChildCount > 0) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Empty static constructor',
      'Empty `static` constructor does nothing, and its mere presence turns off the `beforefieldinit` type-initialization optimization.',
      sourceCode,
      'Remove the empty static constructor.',
    )
  },
}
