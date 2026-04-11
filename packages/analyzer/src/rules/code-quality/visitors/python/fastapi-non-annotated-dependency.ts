import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import {
  importsFastApi,
  isFastApiDependsCall,
} from '../../../_shared/python-framework-detection.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

function isAnnotatedType(annotation: SyntaxNode): boolean {
  // Annotated[type, Depends(...)]
  if (annotation.type === 'subscript') {
    const value = annotation.childForFieldName('value')
    return value?.text === 'Annotated'
  }
  return false
}

export const pythonFastapiNonAnnotatedDependencyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/fastapi-non-annotated-dependency',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    // Only applies to FastAPI files. Pre-fix this fired on any file that
    // happened to call a function named `Depends()`, including custom
    // internal helpers in non-FastAPI codebases.
    if (!importsFastApi(node)) return null

    const params = node.childForFieldName('parameters')
    if (!params) return null

    for (const param of params.namedChildren) {
      if (param.type === 'default_parameter' || param.type === 'typed_default_parameter') {
        const defaultValue = param.childForFieldName('value')
        // Match any FastAPI DI helper (Depends, Query, Body, Path, Header,
        // Cookie, Form, File, Security) — not just the literal `Depends`.
        if (!defaultValue || !isFastApiDependsCall(defaultValue)) continue

        const annotation = param.childForFieldName('type')
        if (!annotation || !isAnnotatedType(annotation)) {
          const nameNode = param.namedChildren[0]
          const paramName = nameNode?.text ?? 'param'
          return makeViolation(
            this.ruleKey, param, filePath, 'low',
            'FastAPI non-annotated dependency',
            `Parameter \`${paramName}\` uses \`Depends()\` but is not wrapped in \`Annotated[type, Depends(...)]\`. The modern FastAPI pattern uses \`Annotated\` for better tooling support.`,
            sourceCode,
            `Change to \`${paramName}: Annotated[YourType, Depends(your_dep)]\` and import \`Annotated\` from \`typing\`.`,
          )
        }
      }
    }

    return null
  },
}
