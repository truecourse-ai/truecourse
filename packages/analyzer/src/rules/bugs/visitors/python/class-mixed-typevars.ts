import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects classes that mix old-style TypeVar with new-style type parameters
 * (PEP 695 syntax). Using both styles is inconsistent and confusing.
 *
 * Example:
 *   from typing import TypeVar
 *   T = TypeVar('T')
 *
 *   class Foo[U](Generic[T]):   # mixed — PEP 695 [U] + old TypeVar T
 *       pass
 */
export const pythonClassMixedTypevarsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/class-mixed-typevars',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    // Check for PEP 695 type_parameter clause: `class Foo[T]:`
    const typeParams = node.childForFieldName('type_parameters')
    if (!typeParams) return null

    // Check if the class also uses old-style Generic[T] or TypeVar in bases
    const superclasses = node.childForFieldName('superclasses')
    if (!superclasses) return null

    const bases = superclasses.namedChildren
    for (const base of bases) {
      // Look for Generic[T], Protocol[T], etc.
      if (base.type === 'subscript') {
        const value = base.childForFieldName('value')
        if (value && (value.text === 'Generic' || value.text === 'Protocol')) {
          return makeViolation(
            this.ruleKey,
            node.childForFieldName('name') || node,
            filePath,
            'medium',
            'Class mixes TypeVar styles',
            `Class uses PEP 695 type parameters \`${typeParams.text}\` but also inherits from \`${base.text}\` — mixing old-style and new-style type parameters is inconsistent.`,
            sourceCode,
            'Use either PEP 695 syntax exclusively or old-style TypeVar/Generic exclusively.',
          )
        }
      }
    }

    return null
  },
}
