import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects binary operators applied to obviously incompatible literal types.
 * Heuristic-based — only flags when both operands are literals of types
 * that cannot be combined with the given operator.
 *
 * Examples:
 *   "hello" + 42          # str + int → TypeError
 *   "hello" - "world"     # str - str → TypeError
 *   [1, 2] / 3            # list / int → TypeError
 */
export const pythonIncompatibleOperatorTypesVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/incompatible-operator-types',
  languages: ['python'],
  nodeTypes: ['binary_operator'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.childForFieldName('operator')?.text
      || node.children.find((c) => !c.isNamed)?.text

    if (!left || !right || !operator) return null

    const leftKind = getLiteralKind(left)
    const rightKind = getLiteralKind(right)
    if (!leftKind || !rightKind) return null

    // Check if the operator is valid for this pair of types
    if (isIncompatible(operator, leftKind, rightKind)) {
      return makeViolation(
        this.ruleKey,
        node,
        filePath,
        'high',
        'Operator used on incompatible types',
        `\`${operator}\` cannot be applied to \`${leftKind}\` and \`${rightKind}\` — \`TypeError\` at runtime.`,
        sourceCode,
        'Convert operands to compatible types or use the correct operator.',
      )
    }

    return null
  },
}

type PyType = 'int' | 'float' | 'str' | 'bool' | 'list' | 'dict' | 'set' | 'tuple' | 'none'

function getLiteralKind(node: SyntaxNode): PyType | null {
  switch (node.type) {
    case 'integer': return 'int'
    case 'float': return 'float'
    case 'string':
    case 'concatenated_string': return 'str'
    case 'true':
    case 'false': return 'bool'
    case 'none': return 'none'
    case 'list': return 'list'
    case 'dictionary': return 'dict'
    case 'set': return 'set'
    case 'tuple': return 'tuple'
    default: return null
  }
}

/**
 * Check if operator cannot be applied to these types.
 * We only flag clear-cut TypeError cases.
 */
function isIncompatible(op: string, left: PyType, right: PyType): boolean {
  const NUMERIC = new Set<PyType>(['int', 'float', 'bool'])
  const ARITHMETIC_OPS = new Set(['-', '/', '//', '%', '**'])
  const ALL_MATH_OPS = new Set(['+', '-', '*', '/', '//', '%', '**'])

  // None with any math operator
  if (left === 'none' || right === 'none') {
    if (ALL_MATH_OPS.has(op)) return true
  }

  // str + numeric (not * which is repeat)
  if (op === '+') {
    if (left === 'str' && NUMERIC.has(right)) return true
    if (NUMERIC.has(left) && right === 'str') return true
  }

  // str with arithmetic operators (except + for concat and * for repeat)
  if (ARITHMETIC_OPS.has(op)) {
    if (left === 'str' || right === 'str') return true
  }

  // list/dict/set/tuple with arithmetic ops (except list + list, list * int)
  const CONTAINER = new Set<PyType>(['list', 'dict', 'set', 'tuple'])
  if (op === '/' || op === '//' || op === '%' || op === '**') {
    if (CONTAINER.has(left) || CONTAINER.has(right)) return true
  }
  if (op === '-') {
    // set - set is valid, but list - list is not
    if ((left === 'list' || left === 'tuple' || left === 'dict') ||
        (right === 'list' || right === 'tuple' || right === 'dict')) return true
  }

  // dict + anything
  if (op === '+' && (left === 'dict' || right === 'dict')) return true

  return false
}
