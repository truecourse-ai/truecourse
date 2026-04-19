import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { TypeQueryService } from '../../../../ts-compiler.js'

/**
 * Detects function parameters typed as mutable array or object types
 * that should be `readonly` to prevent unintended mutation.
 *
 * Catches:
 *   - `items: string[]` → should be `items: readonly string[]`
 *   - `items: Array<string>` → should be `items: ReadonlyArray<string>`
 *
 * Uses TypeQueryService to confirm the parameter type is an array/tuple.
 */
export const readonlyParameterTypesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/readonly-parameter-types',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['required_parameter', 'optional_parameter'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery?: TypeQueryService) {
    if (!typeQuery) return null

    const typeAnnotation = node.childForFieldName('type')
    if (!typeAnnotation) return null

    // Get the actual type node inside the type annotation
    const typeNode = typeAnnotation.namedChildren[0]
    if (!typeNode) return null

    const paramName = node.childForFieldName('pattern')?.text
      || node.childForFieldName('name')?.text
      || '?'

    // Check for mutable array types: `string[]`, `Array<X>`, `number[][]`
    if (isMutableArrayType(typeNode)) {
      return makeViolation(
        this.ruleKey,
        typeNode,
        filePath,
        'low',
        'Parameter should use readonly type',
        `Parameter \`${paramName}\` is typed as a mutable array. Use \`readonly\` to prevent unintended mutation.`,
        sourceCode,
        `Change \`${typeNode.text}\` to its readonly equivalent (e.g., \`readonly string[]\` or \`ReadonlyArray<string>\`).`,
      )
    }

    return null
  },
}

function isMutableArrayType(node: SyntaxNode): boolean {
  // `string[]` → tree-sitter: array_type
  if (node.type === 'array_type') {
    // Check it's not already inside a readonly_type
    if (node.parent?.type === 'readonly_type') return false
    return true
  }

  // `Array<string>` → tree-sitter: generic_type with identifier "Array"
  if (node.type === 'generic_type') {
    const nameNode = node.childForFieldName('name') || node.namedChildren[0]
    if (nameNode?.text === 'Array') return true
  }

  return false
}
