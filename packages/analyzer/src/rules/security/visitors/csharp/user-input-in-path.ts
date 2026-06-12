import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { enclosingFunctionText, findRequestTaint, getCallArgs, getCreatedTypeName, isWrappedInCall, lastSegment } from './_helpers.js'

/**
 * Path traversal: File/Directory operations (or FileStream/StreamReader
 * construction) on a path containing route-handler input — a string action
 * parameter, `<IFormFile>.FileName`, or direct Request access — without
 * Path.GetFileName sanitization or a GetFullPath+StartsWith containment
 * check in the same method.
 */
const FILE_METHODS = new Set([
  'ReadAllText', 'ReadAllTextAsync', 'ReadAllBytes', 'ReadAllBytesAsync',
  'ReadAllLines', 'ReadAllLinesAsync', 'ReadLines',
  'WriteAllText', 'WriteAllTextAsync', 'WriteAllBytes', 'WriteAllBytesAsync',
  'WriteAllLines', 'AppendAllText', 'AppendAllTextAsync', 'AppendAllLines',
  'Open', 'OpenRead', 'OpenWrite', 'OpenText', 'Create', 'Delete', 'Move', 'Copy',
])
const FILE_RECEIVERS = new Set(['File', 'Directory'])
const STREAM_TYPES = new Set(['FileStream', 'StreamReader', 'StreamWriter'])
const SANITIZERS = new Set(['GetFileName', 'GetFileNameWithoutExtension'])

export const csharpUserInputInPathVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/user-input-in-path',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'object_creation_expression'],
  visit(node, filePath, sourceCode) {
    let pathArgs
    let sinkLabel = ''

    if (node.type === 'invocation_expression') {
      const methodName = getCSharpMethodName(node)
      const receiver = lastSegment(getCSharpReceiver(node))
      if (!FILE_RECEIVERS.has(receiver) || !FILE_METHODS.has(methodName)) return null
      pathArgs = getCallArgs(node).slice(0, methodName === 'Move' || methodName === 'Copy' ? 2 : 1)
      sinkLabel = `${receiver}.${methodName}()`
    } else {
      const typeName = getCreatedTypeName(node)
      if (!STREAM_TYPES.has(typeName)) return null
      pathArgs = getCallArgs(node).slice(0, 1)
      sinkLabel = `new ${typeName}()`
    }

    for (const arg of pathArgs) {
      const taint = findRequestTaint(arg.value)
      if (!taint) continue
      // Path.GetFileName(...) around the tainted value strips directory parts.
      if (isWrappedInCall(taint, arg.value, SANITIZERS)) continue
      // Canonical containment check in the same method.
      const body = enclosingFunctionText(node)
      if (/\bGetFullPath\s*\(/.test(body) && /\bStartsWith\s*\(/.test(body)) continue

      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'User input in file path',
        `${sinkLabel} uses user-controlled input ("${taint.text}") in the path. This allows path traversal (../../) attacks.`,
        sourceCode,
        'Sanitize with Path.GetFileName(), or resolve with Path.GetFullPath() and verify the result stays under the expected root.',
      )
    }
    return null
  },
}
