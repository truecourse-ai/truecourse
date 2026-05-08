import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const arrayDeleteVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/array-delete',
  languages: JS_LANGUAGES,
  nodeTypes: ['unary_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    const op = node.children.find((c) => c.text === 'delete')
    if (!op) return null

    const argument = node.childForFieldName('argument')
    if (!argument || argument.type !== 'subscript_expression') return null

    // The rule's intent is "delete on an Array element" — on arrays
    // it leaves an `undefined` hole instead of shrinking the array.
    // On a `Record<string, T>` / index-signature map / regular
    // object, `delete obj[key]` IS the canonical removal — skip.
    const objExpr = argument.childForFieldName('object')
    if (objExpr && typeQuery) {
      const t = typeQuery.getTypeAtPosition(
        filePath,
        objExpr.startPosition.row, objExpr.startPosition.column,
        objExpr.endPosition.row, objExpr.endPosition.column,
      )
      // Only flag when the LHS is statically typed as an Array.
      // Anything else (Record, index-signature object, plain object,
      // unknown) is not the array-hole bug.
      if (t && !/^(?:readonly\s+)?[A-Za-z0-9_$]*\[\]|^(?:Readonly)?Array<|^Tuple<|^\[/.test(t)) return null
      if (!t) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'delete on array element',
      `\`${node.text}\` leaves a hole (undefined slot) in the array instead of removing the element. Use \`splice()\` to properly remove elements.`,
      sourceCode,
      'Use `arr.splice(index, 1)` to remove an element without leaving a hole.',
    )
  },
}
