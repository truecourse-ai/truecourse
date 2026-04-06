import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const collectionSizeMischeckVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/collection-size-mischeck',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => ['===', '!==', '==', '!='].includes(c.text))

    if (!left || !right || !operator) return null

    // Check if one side is .length and the other is undefined/null
    function isSizeProp(n: SyntaxNode): boolean {
      if (n.type !== 'member_expression') return false
      const prop = n.childForFieldName('property')
      return prop?.text === 'length' || prop?.text === 'size'
    }

    function isNullishLiteral(n: SyntaxNode): boolean {
      return n.type === 'null' || n.type === 'undefined'
    }

    if (isSizeProp(left) && isNullishLiteral(right)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Collection size mischeck',
        `\`${left.text} ${operator.text} ${right.text}\` is always ${operator.text === '===' || operator.text === '==' ? 'false' : 'true'} — \`${left.text}\` is always a number. Did you mean \`${left.text} > 0\`?`,
        sourceCode,
        `Replace with \`${left.text} > 0\` to check if the collection is non-empty.`,
      )
    }

    if (isSizeProp(right) && isNullishLiteral(left)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Collection size mischeck',
        `\`${left.text} ${operator.text} ${right.text}\` is always ${operator.text === '===' || operator.text === '==' ? 'false' : 'true'} — \`${right.text}\` is always a number. Did you mean \`${right.text} > 0\`?`,
        sourceCode,
        `Replace with \`${right.text} > 0\` to check if the collection is non-empty.`,
      )
    }

    return null
  },
}
