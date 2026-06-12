import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Reserved/base exception types that should never be thrown directly (CA2201). */
const BROAD_EXCEPTIONS = new Set(['Exception', 'SystemException', 'ApplicationException'])

function simpleTypeName(typeNode: SyntaxNode | null): string {
  if (!typeNode) return ''
  if (typeNode.type === 'qualified_name') return typeNode.childForFieldName('name')?.text ?? ''
  return typeNode.text
}

/**
 * `throw new Exception("…")` — the base type carries no meaning, forcing
 * callers into `catch (Exception)`. CA2201.
 */
export const csharpBroadExceptionRaisedVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/broad-exception-raised',
  languages: ['csharp'],
  nodeTypes: ['throw_statement', 'throw_expression'],
  visit(node, filePath, sourceCode) {
    const creation = node.namedChildren.find((c) => c?.type === 'object_creation_expression')
    if (!creation) return null
    const typeName = simpleTypeName(creation.childForFieldName('type'))
    if (!BROAD_EXCEPTIONS.has(typeName)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Broad exception thrown',
      `Throwing \`${typeName}\` is too broad — callers cannot catch it without catching everything (CA2201).`,
      sourceCode,
      'Throw a specific type instead: InvalidOperationException, ArgumentException, or a domain exception class.',
    )
  },
}
