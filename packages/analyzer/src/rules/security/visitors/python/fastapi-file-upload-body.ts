import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonFastapiFileUploadBodyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/fastapi-file-upload-body',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    // Check parameters for UploadFile type annotation without size constraint
    for (const param of params.namedChildren) {
      const paramText = param.text
      if (/UploadFile/.test(paramText) && !/max_size|size_limit/.test(paramText)) {
        // Check if there's no max_size validation in the function body
        const body = node.childForFieldName('body')
        if (body && !/max_size|size_limit|content.length|\.size/.test(body.text)) {
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
