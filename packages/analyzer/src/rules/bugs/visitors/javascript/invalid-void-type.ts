import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detects: void used as a type in invalid positions
// Valid positions: function return types, generic type arguments
// Invalid: variable types, parameter types (outside of generics)
export const invalidVoidTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-void-type',
  languages: JS_LANGUAGES,
  nodeTypes: ['required_parameter', 'optional_parameter', 'rest_parameter'],
  visit(node, filePath, sourceCode) {
    // Check for void in function parameter type annotations
    const typeAnnotation = node.namedChildren.find((c) => c.type === 'type_annotation')
    if (!typeAnnotation) return null

    // Only flag `void` when it is the parameter's direct type. `void` nested
    // inside a function return type (`(cb: () => void) => void`), a generic
    // argument (`Promise<void>`), or similar wrapper is a valid usage.
    const directType = typeAnnotation.namedChildren[0]
    if (!directType) return null
    const voidType =
      directType.type === 'void_type' ||
      (directType.type === 'predefined_type' && directType.text === 'void')
        ? directType
        : null
    if (!voidType) return null

    const paramName = node.namedChildren[0]?.text ?? 'parameter'

    return makeViolation(
      this.ruleKey, voidType, filePath, 'medium',
      'void type in invalid position',
      `\`void\` used as a type for parameter \`${paramName}\` — \`void\` is only valid in function return types or specific generic positions (like \`Promise<void>\`).`,
      sourceCode,
      'Replace `void` with `undefined` if you mean the parameter is not provided, or use a more specific type.',
    )
  },
}

