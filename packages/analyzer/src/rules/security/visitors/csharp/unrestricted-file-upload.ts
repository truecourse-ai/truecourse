import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames } from '../../../_shared/csharp-helpers.js'

/**
 * Upload endpoint with the body size limit explicitly removed:
 * `[DisableRequestSizeLimit]` on an action taking IFormFile. ASP.NET's
 * default 30 MB limit is the protection this attribute strips.
 */
export const csharpUnrestrictedFileUploadVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unrestricted-file-upload',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const attrs = getCSharpAttributeNames(node)
    if (!attrs.includes('DisableRequestSizeLimit')) return null

    const params = node.childForFieldName('parameters') ?? node.namedChildren.find((c) => c?.type === 'parameter_list')
    if (!params || !/\bIFormFile/.test(params.text)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Unrestricted file upload',
      '[DisableRequestSizeLimit] removes the request body limit on a file-upload action — arbitrarily large uploads can exhaust disk/memory.',
      sourceCode,
      'Replace with [RequestSizeLimit(maxBytes)] sized for the expected uploads.',
    )
  },
}
