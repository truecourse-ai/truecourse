import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsPythonIdentifierExact } from '../../../_shared/python-helpers.js'

export const pythonFastapiFileUploadBodyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/fastapi-file-upload-body',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    // Check parameters for UploadFile type annotation
    let hasUploadFile = false
    for (const param of params.namedChildren) {
      // Check the type annotation for UploadFile identifier
      const typeAnnotation = param.childForFieldName('type')
      if (typeAnnotation && containsPythonIdentifierExact(typeAnnotation, 'UploadFile')) {
        hasUploadFile = true
        break
      }
      // Also handle typed_default_parameter
      if (param.type === 'typed_default_parameter') {
        const typeNode = param.childForFieldName('type')
        if (typeNode && containsPythonIdentifierExact(typeNode, 'UploadFile')) {
          hasUploadFile = true
          break
        }
      }
    }

    if (hasUploadFile) {
      // Check if the function body has size validation
      const body = node.childForFieldName('body')
      if (body) {
        const hasSizeCheck =
          containsPythonIdentifierExact(body, 'max_size') ||
          containsPythonIdentifierExact(body, 'size_limit') ||
          containsPythonIdentifierExact(body, 'MAX_SIZE') ||
          containsPythonIdentifierExact(body, 'MAX_FILE_SIZE') ||
          containsPythonIdentifierExact(body, 'content_length')
        if (!hasSizeCheck) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'FastAPI file upload without size limit',
            'FastAPI endpoint accepts file uploads (UploadFile) without enforcing a maximum file size.',
            sourceCode,
            'Add a file size check: if file.size > MAX_SIZE: raise HTTPException(413).',
          )
        }
      }
    }

    return null
  },
}
