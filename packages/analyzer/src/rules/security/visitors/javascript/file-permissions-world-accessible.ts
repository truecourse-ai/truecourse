import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const WORLD_PERMS = new Set(['0o777', '0o776', '0o766', '0o667', '0o666'])

export const filePermissionsWorldAccessibleVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/file-permissions-world-accessible',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (methodName !== 'chmod' && methodName !== 'chmodSync' && methodName !== 'writeFile' && methodName !== 'writeFileSync') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // For chmod/chmodSync: second arg is mode; for writeFile: options object or third arg
    for (const arg of args.namedChildren) {
      const t = arg.text.toLowerCase()
      if (WORLD_PERMS.has(t) || t === '511' || t === '438') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'World-accessible file permissions',
          `${methodName}() sets overly permissive file permissions (${arg.text}).`,
          sourceCode,
          'Use restrictive permissions like 0o600 or 0o644.',
        )
      }
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            const value = prop.childForFieldName('value')
            if (key?.text === 'mode' && value) {
              const vt = value.text.toLowerCase()
              if (WORLD_PERMS.has(vt) || vt === '511' || vt === '438') {
                return makeViolation(
                  this.ruleKey, node, filePath, 'high',
                  'World-accessible file permissions',
                  `${methodName}() sets overly permissive file permissions (${value.text}).`,
                  sourceCode,
                  'Use restrictive permissions like 0o600 or 0o644.',
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
