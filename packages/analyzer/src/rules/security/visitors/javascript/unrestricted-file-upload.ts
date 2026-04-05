import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unrestrictedFileUploadVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unrestricted-file-upload',
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

    if (funcName !== 'multer') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check if fileFilter is provided in the options object
    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            if (key?.text === 'fileFilter') return null
          }
        }
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Unrestricted file upload',
      'multer() configured without fileFilter. Any file type can be uploaded.',
      sourceCode,
      'Add a fileFilter option to validate file types and sizes.',
    )
  },
}
