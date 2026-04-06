import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const FS_READ_WRITE_METHODS = new Set([
  'readFile', 'readFileSync', 'writeFile', 'writeFileSync',
  'readdir', 'readdirSync', 'unlink', 'unlinkSync',
  'stat', 'statSync', 'access', 'accessSync',
  'open', 'openSync', 'createReadStream', 'createWriteStream',
])

export const userInputInPathVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/user-input-in-path',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

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

    if (!FS_READ_WRITE_METHODS.has(methodName)) return null
    // Skip path.join — covered by path-command-injection
    if (objectName === 'path') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const argText = firstArg.text.toLowerCase()
    if (argText.includes('req.') || argText.includes('req[') ||
        argText.includes('params') || argText.includes('query') ||
        argText.includes('body') || argText.includes('userinput') ||
        argText.includes('user_input') || argText.includes('filename')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'User input in file path',
        `${methodName}() called with user-controlled path. This may allow path traversal attacks.`,
        sourceCode,
        'Validate and sanitize file paths. Use path.resolve() and verify the result stays within the expected directory.',
      )
    }

    return null
  },
}
