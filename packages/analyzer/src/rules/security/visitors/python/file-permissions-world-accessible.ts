import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PYTHON_WORLD_PERMS = new Set(['0o777', '0o776', '0o766', '0o667', '0o666'])

export const pythonFilePermissionsWorldAccessibleVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/file-permissions-world-accessible',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr) methodName = attr.text
      if (obj) objectName = obj.text
    }

    if (methodName !== 'chmod') return null
    if (objectName !== 'os') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      const t = arg.text.toLowerCase()
      if (PYTHON_WORLD_PERMS.has(t) || t === '511' || t === '438') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'World-accessible file permissions',
          `os.chmod() sets overly permissive file permissions (${arg.text}).`,
          sourceCode,
          'Use restrictive permissions like 0o600 or 0o644.',
        )
      }
    }

    return null
  },
}
