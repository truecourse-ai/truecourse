import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const ORM_CREATE_METHODS = new Set(['create', 'update', 'updateOne', 'updateMany', 'findOneAndUpdate', 'save', 'insert', 'insertOne'])

export const massAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/mass-assignment',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    }

    if (!ORM_CREATE_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Look for req.body or spread of req.body directly as the first/second argument
    for (const arg of args.namedChildren) {
      if (arg.type === 'member_expression') {
        const obj = arg.childForFieldName('object')
        const prop = arg.childForFieldName('property')
        if (obj?.text === 'req' && prop?.text === 'body') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Mass assignment vulnerability',
            `${methodName}() called directly with req.body. Attackers can set arbitrary fields.`,
            sourceCode,
            'Use an allowlist to pick only expected fields: const { name, email } = req.body.',
          )
        }
      }
      // Spread of req.body: { ...req.body }
      if (arg.type === 'object') {
        for (const child of arg.namedChildren) {
          if (child.type === 'spread_element') {
            const spreadText = child.text
            if (spreadText.includes('req.body')) {
              return makeViolation(
                this.ruleKey, node, filePath, 'high',
                'Mass assignment vulnerability',
                `${methodName}() called with spread of req.body. Attackers can set arbitrary fields.`,
                sourceCode,
                'Use an allowlist to pick only expected fields: const { name, email } = req.body.',
              )
            }
          }
        }
      }
    }

    return null
  },
}
