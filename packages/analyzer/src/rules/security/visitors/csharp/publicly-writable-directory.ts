import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, getCreatedTypeName, isStringNode, lastSegment, staticStringText } from './_helpers.js'

/**
 * Files written under hardcoded world-writable paths (/tmp, /var/tmp,
 * /dev/shm) — local users can pre-create/symlink the name and hijack the
 * write. Path.GetTempFileName() (atomic, unique) is the safe idiom.
 */
const TMP_PATH_PATTERN = /^\/(?:tmp|var\/tmp|dev\/shm)\//
const WRITE_METHODS = new Set([
  'WriteAllText', 'WriteAllTextAsync', 'WriteAllBytes', 'WriteAllBytesAsync',
  'WriteAllLines', 'AppendAllText', 'AppendAllTextAsync', 'AppendAllLines',
  'Create', 'CreateText', 'Open', 'OpenWrite',
])

export const csharpPubliclyWritableDirectoryVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/publicly-writable-directory',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'object_creation_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'invocation_expression') {
      if (lastSegment(getCSharpReceiver(node)) !== 'File' || !WRITE_METHODS.has(getCSharpMethodName(node))) return null
    } else if (getCreatedTypeName(node) !== 'FileStream' && getCreatedTypeName(node) !== 'StreamWriter') {
      return null
    }

    const pathArg = getCallArgs(node)[0]?.value
    if (!pathArg || !isStringNode(pathArg)) return null
    const text = staticStringText(pathArg)
    if (!TMP_PATH_PATTERN.test(text)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Writing to world-writable directory',
      `Writing to "${text}" — a world-writable directory where another local user can pre-create or symlink the file.`,
      sourceCode,
      'Use Path.GetTempFileName(), or a uniquely named file under Path.GetTempPath() created with FileMode.CreateNew.',
    )
  },
}
