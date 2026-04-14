import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const s3InsecureHttpVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/s3-insecure-http',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['new_expression', 'call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function') ?? node.childForFieldName('constructor')
    if (!fn) return null

    let name = ''
    if (fn.type === 'identifier') {
      name = fn.text
    } else if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) name = prop.text
    }

    if (name !== 'S3' && name !== 'S3Client') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const child of arg.namedChildren) {
          if (child.type === 'pair') {
            const key = child.childForFieldName('key')?.text?.replace(/['"]/g, '')
            const value = child.childForFieldName('value')
            if (key === 'ssl' && value?.text === 'false') {
              return makeViolation(
                this.ruleKey, node, filePath, 'high',
                'S3 client without SSL',
                'S3 client configured with ssl: false. Data in transit will not be encrypted.',
                sourceCode,
                'Remove ssl: false or set ssl: true to ensure encrypted S3 communication.',
              )
            }
            // endpoint with http://
            if (key === 'endpoint' && value) {
              const ep = value.text.replace(/['"]/g, '')
              if (ep.startsWith('http://') && !ep.includes('localhost') && !ep.includes('127.0.0.1')) {
                return makeViolation(
                  this.ruleKey, node, filePath, 'high',
                  'S3 client without SSL',
                  `S3 client endpoint "${ep}" uses HTTP instead of HTTPS.`,
                  sourceCode,
                  'Use an HTTPS endpoint for S3 to encrypt data in transit.',
                )
              }
            }
          }
        }
      }
    }

    return null
  },
}
