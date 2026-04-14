import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detects: using String, Number, Boolean, Object, Symbol, BigInt as type annotations
// Should use string, number, boolean, object, symbol, bigint (lowercase primitives)
const WRAPPER_TYPES = new Map([
  ['String', 'string'],
  ['Number', 'number'],
  ['Boolean', 'boolean'],
  ['Object', 'object'],
  ['Symbol', 'symbol'],
  ['BigInt', 'bigint'],
])

export const wrapperObjectTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/wrapper-object-type',
  languages: JS_LANGUAGES,
  nodeTypes: ['type_annotation'],
  visit(node, filePath, sourceCode) {
    // Walk through type annotation looking for wrapper type references
    const typeRef = findWrapperType(node)
    if (!typeRef) return null

    const wrapperName = typeRef.text
    const primitive = WRAPPER_TYPES.get(wrapperName)!

    return makeViolation(
      this.ruleKey, typeRef, filePath, 'high',
      'Wrapper object type used instead of primitive',
      `Using \`${wrapperName}\` (wrapper object) as a type — use \`${primitive}\` (primitive) instead. Wrapper objects are rarely interchangeable with primitives.`,
      sourceCode,
      `Replace \`${wrapperName}\` with \`${primitive}\`.`,
    )
  },
}

function findWrapperType(node: import('tree-sitter').SyntaxNode): import('tree-sitter').SyntaxNode | null {
  for (const child of node.namedChildren) {
    if (child.type === 'type_identifier' && WRAPPER_TYPES.has(child.text)) {
      return child
    }
    const found = findWrapperType(child)
    if (found) return found
  }
  return null
}
