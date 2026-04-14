import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const catchWithoutErrorTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/catch-without-error-type',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    // Get the catch parameter
    const param = node.childForFieldName('parameter')
    if (!param) {
      // catch without parameter at all — also a problem but less common
      return null
    }

    // If the catch body checks instanceof or typeof, it's fine
    const body = node.childForFieldName('body')
    if (!body) return null
    const bodyText = body.text
    if (bodyText.includes('instanceof') || bodyText.includes('typeof')) return null

    // Check for type annotation on the parameter (TS catch(e: SomeType))
    // In tree-sitter, a typed catch param has a type_annotation child
    const hasTypeAnnotation = param.namedChildren.some((c) => c.type === 'type_annotation')
    if (hasTypeAnnotation) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Catch without error type discrimination',
      'Catch block does not check or narrow the error type. Different error types may need different handling.',
      sourceCode,
      'Use instanceof checks or type guards in the catch block to handle specific error types.',
    )
  },
}
