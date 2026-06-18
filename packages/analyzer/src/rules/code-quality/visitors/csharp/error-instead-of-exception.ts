import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

function simpleBaseName(base: SyntaxNode): string {
  if (base.type === 'qualified_name') return base.childForFieldName('name')?.text ?? ''
  if (base.type === 'generic_name') return base.namedChildren.find((c) => c?.type === 'identifier')?.text ?? ''
  return base.text
}

/**
 * Exception class named `*Error` instead of `*Exception`. .NET naming
 * (CA1710) suffixes exception types with "Exception"; "Error" is the
 * Java/JS convention and misleads catch-site readers.
 */
export const csharpErrorInsteadOfExceptionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/error-instead-of-exception',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')?.text
    if (!name || !name.endsWith('Error')) return null

    const baseList = node.namedChildren.find((c) => c?.type === 'base_list')
    if (!baseList) return null
    const derivesFromException = baseList.namedChildren.some((base) => {
      if (!base) return false
      const baseName = simpleBaseName(base)
      return baseName === 'Exception' || baseName.endsWith('Exception')
    })
    if (!derivesFromException) return null

    const fixed = `${name.slice(0, -'Error'.length)}Exception`
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Exception type named *Error',
      `\`${name}\` derives from Exception but is named like a Java/JS error type — .NET exception types end in "Exception" (CA1710).`,
      sourceCode,
      `Rename \`${name}\` to \`${fixed}\`.`,
    )
  },
}
