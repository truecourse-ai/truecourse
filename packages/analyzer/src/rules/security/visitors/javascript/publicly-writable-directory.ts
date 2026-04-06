import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const TMP_PATH_PATTERNS = ['/tmp/', '/var/tmp/', '/dev/shm/']

export const publiclyWritableDirectoryVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/publicly-writable-directory',
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

    if (methodName !== 'writeFile' && methodName !== 'writeFileSync' &&
        methodName !== 'appendFile' && methodName !== 'appendFileSync' &&
        methodName !== 'open' && methodName !== 'openSync') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const pathText = firstArg.text.replace(/['"]/g, '')
    for (const tmpPath of TMP_PATH_PATTERNS) {
      if (pathText.startsWith(tmpPath) || pathText.includes(tmpPath)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Writing to world-writable directory',
          `${methodName}() writes to "${pathText}" which is a world-writable directory. Race conditions may allow attackers to hijack the file.`,
          sourceCode,
          'Use os.tmpdir() with a uniquely named file, or use a library like tmp or tempfile for secure temp file creation.',
        )
      }
    }

    return null
  },
}
