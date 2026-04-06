import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Assert methods that take (actual, expected) but people commonly swap them
const INVERTED_METHODS = new Set([
  'equal', 'strictEqual', 'deepEqual', 'notEqual', 'notStrictEqual',
  'deepStrictEqual', 'equals', 'strictEquals',
])

const LITERAL_TYPES = new Set([
  'number', 'string', 'true', 'false', 'null',
  'template_string',
])

function isLiteral(node: import('tree-sitter').SyntaxNode): boolean {
  return (
    LITERAL_TYPES.has(node.type) ||
    (node.type === 'identifier' && (node.text === 'true' || node.text === 'false' || node.text === 'null' || node.text === 'undefined')) ||
    (node.type === 'unary_expression' && node.child(1)?.type === 'number')
  )
}

export const testInvertedArgumentsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-inverted-arguments',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')

    if (!prop || !INVERTED_METHODS.has(prop.text)) return null
    if (!obj || (obj.text !== 'assert' && !obj.text.includes('assert'))) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    if (argList.length < 2) return null

    const actual = argList[0]
    const expected = argList[1]

    if (!actual || !expected) return null

    // Heuristic: if actual is a literal and expected is not — likely inverted
    if (isLiteral(actual) && !isLiteral(expected)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Inverted assertion arguments',
        `Assertion \`${prop.text}(actual, expected)\` may have swapped arguments — expected value looks like it's in the actual position.`,
        sourceCode,
        `Swap the arguments: \`${obj.text}.${prop.text}(${expected.text}, ${actual.text})\``,
      )
    }

    return null
  },
}
