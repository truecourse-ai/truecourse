import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Bare `{ }` block nested directly in another block with no local
 * declarations inside. Blocks that declare locals are the C# scoping idiom
 * (e.g. repeating `var` setups in sequence) and are left alone.
 */
export const csharpUnnecessaryBlockVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-block',
  languages: ['csharp'],
  nodeTypes: ['block'],
  visit(node, filePath, sourceCode) {
    if (node.parent?.type !== 'block') return null

    const declaresLocals = node.namedChildren.some(
      (c) => c?.type === 'local_declaration_statement' || c?.type === 'local_function_statement',
    )
    if (declaresLocals) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary block',
      'Standalone `{ }` block declares no locals, so it creates no useful scope — remove the braces.',
      sourceCode,
      'Remove the redundant braces, or extract the contents into a named method if grouping was the intent.',
    )
  },
}
