import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const permissiveCorsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/permissive-cors',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) funcName = prop.text
    }

    // cors({ origin: '*' })
    if (funcName === 'cors') {
      const args = node.childForFieldName('arguments')
      if (args) {
        for (const arg of args.namedChildren) {
          if (arg.type === 'object') {
            for (const prop of arg.namedChildren) {
              if (prop.type === 'pair') {
                const key = prop.childForFieldName('key')
                const value = prop.childForFieldName('value')
                if (key?.text === 'origin' && (value?.text === "'*'" || value?.text === '"*"')) {
                  return makeViolation(
                    this.ruleKey, node, filePath, 'high',
                    'Permissive CORS configuration',
                    'CORS with origin: \'*\' allows any domain to make requests.',
                    sourceCode,
                    'Restrict CORS origin to specific trusted domains.',
                  )
                }
              }
            }
          }
        }
      }
    }

    // res.header('Access-Control-Allow-Origin', '*')
    if (funcName === 'header' || funcName === 'setHeader' || funcName === 'set') {
      const args = node.childForFieldName('arguments')
      if (args && args.namedChildren.length >= 2) {
        const headerName = args.namedChildren[0]?.text.replace(/['"]/g, '').toLowerCase()
        const headerValue = args.namedChildren[1]?.text.replace(/['"]/g, '')
        if (headerName === 'access-control-allow-origin' && headerValue === '*') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Permissive CORS configuration',
            'Setting Access-Control-Allow-Origin to \'*\' allows any domain.',
            sourceCode,
            'Restrict the origin to specific trusted domains.',
          )
        }
      }
    }

    return null
  },
}
