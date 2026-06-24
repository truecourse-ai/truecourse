import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * An explicit `: base()` initializer that forwards no arguments duplicates what
 * the compiler already inserts — every constructor implicitly calls the
 * parameterless base constructor first. Removing the empty forward trims noise
 * without changing behaviour. A `: this()` initializer or a `: base(args)` with
 * arguments is meaningful and is not flagged.
 */
export const csharpRedundantBaseConstructorCallVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-base-constructor-call',
  languages: ['csharp'],
  nodeTypes: ['constructor_initializer'],
  visit(node, filePath, sourceCode) {
    // The `base` / `this` keyword follows the leading `:` token.
    if (!node.children.some((c) => c?.type === 'base')) return null

    const argList = node.namedChildren.find((c) => c?.type === 'argument_list')
    if (!argList || argList.namedChildCount > 0) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Redundant base() constructor call',
      'An explicit `: base()` with no arguments duplicates the implicit call the compiler already inserts.',
      sourceCode,
      'Remove the redundant `: base()` initializer.',
    )
  },
}
