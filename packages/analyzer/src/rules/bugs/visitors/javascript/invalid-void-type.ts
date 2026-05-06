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

    const voidType = findVoidType(typeAnnotation)
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

function findVoidType(node: import('web-tree-sitter').Node): import('web-tree-sitter').Node | null {
  for (const child of node.children) {
    // Don't recurse into a function-type literal (`() => T` /
    // `(x: T) => U` / constructor types). Inside the function-type, `void`
    // is legal: it's the function's RETURN type. The rule is about `void`
    // in invalid value-type positions (e.g., a parameter typed `void`),
    // not about the return type of a callback parameter.
    if (
      child.type === 'function_type' ||
      child.type === 'constructor_type'
    ) continue
    // Don't recurse into Promise<void> / Awaited<void> generic positions —
    // void inside a generic argument is also legal.
    if (child.type === 'type_arguments') continue

    if (child.type === 'void_type') return child
    if (child.type === 'predefined_type' && child.text === 'void') return child
    const found = findVoidType(child)
    if (found) return found
  }
  return null
}
