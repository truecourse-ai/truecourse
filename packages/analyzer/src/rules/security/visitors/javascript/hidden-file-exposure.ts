import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const hiddenFileExposureVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/hidden-file-exposure',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // express.static(path) or static(path)
    let methodName = ''
    let objectName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      const obj = fn.childForFieldName('object')
      if (prop) methodName = prop.text
      if (obj) objectName = obj.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (methodName !== 'static') return null
    // Only flag express.static
    if (fn.type === 'member_expression' && objectName !== 'express') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check for options object with dotfiles: 'deny'
    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            const value = prop.childForFieldName('value')
            if (key?.text === 'dotfiles') {
              const val = value?.text.replace(/['"]/g, '').toLowerCase()
              if (val === 'deny' || val === 'ignore') return null
            }
          }
        }
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Hidden file exposure',
      'express.static() serves dotfiles by default. Files like .env or .git may be exposed.',
      sourceCode,
      'Add { dotfiles: "deny" } option to express.static().',
    )
  },
}
