import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const nullDereferenceVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/null-dereference',
  languages: JS_LANGUAGES,
  nodeTypes: ['member_expression', 'subscript_expression'],
  visit(node, filePath, sourceCode) {
    // Look for patterns like: (foo || null).bar, (maybeNull as SomeType).prop
    // Specifically: member access where the object is a nullish literal cast or logical expression ending in null/undefined
    const obj = node.childForFieldName('object')
    if (!obj) return null

    // Helper: is this node a null/undefined literal?
    function isNullish(n: SyntaxNode): boolean {
      return n.type === 'null' || n.type === 'undefined'
    }

    // Detect: null.prop or undefined.prop directly
    if (isNullish(obj)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Null dereference',
        `Accessing property on \`${obj.text}\` will always throw a TypeError.`,
        sourceCode,
        'Add a null check before accessing properties on this value.',
      )
    }

    // Detect: (null).prop or (undefined).prop
    if (obj.type === 'parenthesized_expression') {
      const inner = obj.namedChildren[0]
      if (!inner) return null
      if (isNullish(inner)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Null dereference',
          `Accessing property on \`${inner.text}\` will always throw a TypeError.`,
          sourceCode,
          'Add a null check before accessing properties on this value.',
        )
      }
    }

    return null
  },
}
