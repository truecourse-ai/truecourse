import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const arraySortWithoutCompareVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/array-sort-without-compare',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || (prop.text !== 'sort' && prop.text !== 'toSorted')) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argNodes = args.namedChildren
    // sort() or sort(undefined) with no compare function
    if (argNodes.length === 0 || (argNodes.length === 1 && argNodes[0].type === 'undefined')) {
      // Sorting strings without a comparator is lexicographic, which is
      // exactly what users want for string arrays — the rule's concern is
      // numeric arrays sorted as strings. When type info is available and
      // the receiver is a string-array type, skip.
      const obj = fn.childForFieldName('object')
      if (obj && typeQuery) {
        const typeStr = typeQuery.getTypeAtPosition(
          filePath,
          obj.startPosition.row,
          obj.startPosition.column,
          obj.endPosition.row,
          obj.endPosition.column,
        )
        if (typeStr && isStringArrayType(typeStr)) return null
      }
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Array sorted without comparator',
        `\`.${prop.text}()\` without a compare function sorts elements lexicographically (as strings), which may produce unexpected results for numbers.`,
        sourceCode,
        `Add a compare function: \`.${prop.text}((a, b) => a - b)\` for numeric sort.`,
      )
    }
    return null
  },
}

function isStringArrayType(typeStr: string): boolean {
  let s = typeStr.trim()
  // Strip leading 'readonly '
  s = s.replace(/^readonly\s+/, '')

  // Shape: <element>[] or (<union>)[]
  const bracketParen = /^\((.+)\)\[\]$/.exec(s)
  const bracketBare = /^(.+)\[\]$/.exec(s)
  const inner = bracketParen ? bracketParen[1] : bracketBare ? bracketBare[1] : null
  if (inner !== null) return isStringOrStringLiteralUnion(inner)

  // Shape: Array<X> or ReadonlyArray<X>
  const generic = /^(?:Readonly)?Array<(.+)>$/.exec(s)
  if (generic) return isStringOrStringLiteralUnion(generic[1])

  return false
}

function isStringOrStringLiteralUnion(elementType: string): boolean {
  const parts = elementType.split('|').map((p) => p.trim()).filter((p) => p.length > 0)
  if (parts.length === 0) return false
  return parts.every(
    (p) => p === 'string' || /^"[^"]*"$/.test(p) || /^'[^']*'$/.test(p),
  )
}
