import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * An exception type that is not `public` can only be caught by its declaring
 * assembly. Callers in other assemblies cannot `catch (TException)` it and are
 * forced to catch a broader base type, losing the precise handling the
 * exception was meant to enable. The check targets types that both name
 * themselves `…Exception` and derive (by the naming convention) from an
 * `Exception` base, so it never overlaps the "named like an exception but not
 * one" rule. Nested exception types are skipped — their enclosing type already
 * scopes their visibility deliberately.
 */

function derivesFromException(node: SyntaxNode): boolean {
  const baseList = node.namedChildren.find((c) => c?.type === 'base_list')
  if (!baseList) return false
  return baseList.namedChildren.some((b) => {
    const name = (b?.text.split('<')[0].split('.').pop() ?? '').trim()
    return name.endsWith('Exception')
  })
}

export const csharpExceptionTypeNotPublicVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/exception-type-not-public',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')?.text
    if (!name || !name.endsWith('Exception')) return null
    if (!derivesFromException(node)) return null
    if (hasCSharpModifier(node, 'public')) return null

    // A nested type's accessibility is an intentional choice by its container.
    if (node.parent?.parent?.type === 'class_declaration') return null
    if (node.parent?.parent?.type === 'struct_declaration') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Non-public exception type',
      `Exception \`${name}\` is not \`public\`, so callers in other assemblies cannot catch it by type and must fall back to a broader base.`,
      sourceCode,
      'Make the exception type `public`.',
    )
  },
}
