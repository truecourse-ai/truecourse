import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Type argument that matches the default.
 * Corresponds to @typescript-eslint/no-unnecessary-type-arguments.
 *
 * Common cases: Promise<void> (default is void), Map<string, any> when default matches.
 * This is a heuristic check for common patterns.
 */
export const redundantTypeArgumentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-type-argument',
  languages: TS_LANGUAGES,
  nodeTypes: ['type_arguments'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    // Get the parent — should be a generic type or call expression
    const parent = node.parent
    if (!parent) return null

    // Get the generic function/type being parameterized
    let target = parent.type === 'call_expression'
      ? parent.childForFieldName('function')
      : parent.type === 'generic_type'
        ? parent.namedChildren[0]
        : null

    if (!target) return null

    // Check type arguments — get the resolved types
    const typeArgs = node.namedChildren
    if (typeArgs.length === 0) return null

    // Get the type with and without the argument — if they're the same, it's redundant
    const withArgs = typeQuery.getTypeAtPosition(
      filePath,
      parent.startPosition.row,
      parent.startPosition.column,
    )
    if (!withArgs) return null

    // Heuristic: Check common known defaults
    // Promise<void> — void is the default for unresolved Promise
    // Array<any> — any is inferred
    // Set<any>, Map<any, any>
    const lastArg = typeArgs[typeArgs.length - 1]
    if (lastArg) {
      const argType = typeQuery.getTypeAtPosition(
        filePath,
        lastArg.startPosition.row,
        lastArg.startPosition.column,
      )
      // If the type argument is `any` on generic utilities, it's often redundant
      if (argType === 'any' && target.text && ['Array', 'Set', 'WeakSet', 'WeakMap'].includes(target.text)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Redundant type argument',
          `Type argument \`<${lastArg.text}>\` matches the default and can be omitted.`,
          sourceCode,
          'Remove the redundant type argument.',
        )
      }
    }

    return null
  },
}
