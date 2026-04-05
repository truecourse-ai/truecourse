import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Map from lambda pattern to operator module equivalent
const OPERATOR_MAP: Array<{ pattern: (a: string, b: string) => boolean; name: string }> = [
  { pattern: (body, params) => /^[a-zA-Z_]\w* \+ [a-zA-Z_]\w*$/.test(body), name: 'operator.add' },
  { pattern: (body, params) => /^[a-zA-Z_]\w* - [a-zA-Z_]\w*$/.test(body), name: 'operator.sub' },
  { pattern: (body, params) => /^[a-zA-Z_]\w* \* [a-zA-Z_]\w*$/.test(body), name: 'operator.mul' },
  { pattern: (body, params) => /^[a-zA-Z_]\w* \/ [a-zA-Z_]\w*$/.test(body), name: 'operator.truediv' },
  { pattern: (body, params) => /^[a-zA-Z_]\w* \[.+\]$/.test(body), name: 'operator.getitem' },
  { pattern: (body, params) => /^[a-zA-Z_]\w* \. [a-zA-Z_]\w*$/.test(body.replace(/\s/g, ' ')), name: 'operator.attrgetter' },
]

export const pythonReimplementedOperatorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/reimplemented-operator',
  languages: ['python'],
  nodeTypes: ['lambda'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const params = node.childForFieldName('parameters')
    const paramText = params?.text || ''

    const bodyText = body.text.trim()

    // lambda x, y: x + y
    if (body.type === 'binary_operator') {
      const op = body.children.find((c) => ['+'  , '-', '*', '/', '//', '%', '**', '&', '|', '^'].includes(c.type))
      if (op) {
        const left = body.childForFieldName('left')
        const right = body.childForFieldName('right')
        const paramNames = params ? params.namedChildren.map((p) => p.text) : []
        if (left && right && paramNames.length === 2 &&
            left.text === paramNames[0] && right.text === paramNames[1]) {
          const opMap: Record<string, string> = {
            '+': 'operator.add', '-': 'operator.sub', '*': 'operator.mul',
            '/': 'operator.truediv', '//': 'operator.floordiv', '%': 'operator.mod',
            '**': 'operator.pow', '&': 'operator.and_', '|': 'operator.or_', '^': 'operator.xor',
          }
          const opName = opMap[op.text]
          if (opName) {
            return makeViolation(
              this.ruleKey, node, filePath, 'low',
              'Reimplemented operator',
              `\`lambda ${paramText}: ${bodyText}\` reimplements \`${opName}\` from the \`operator\` module.`,
              sourceCode,
              `Replace with \`${opName}\` from the \`operator\` module.`,
            )
          }
        }
      }
    }

    // lambda x: x[key] → operator.itemgetter(key)
    if (body.type === 'subscript') {
      const obj = body.childForFieldName('value')
      const paramNames = params ? params.namedChildren.map((p) => p.text) : []
      if (obj && paramNames.length === 1 && obj.text === paramNames[0]) {
        const keyNode = body.childForFieldName('subscript')
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Reimplemented operator',
          `\`lambda ${paramText}: ${bodyText}\` can be replaced with \`operator.itemgetter(${keyNode?.text || '...'})\`.`,
          sourceCode,
          `Replace with \`operator.itemgetter(${keyNode?.text || '...'})\`.`,
        )
      }
    }

    return null
  },
}
