import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Type aliases inside a `namespace X { … }` (or a `declare global { … }`
// block) are deliberately bridging a name from another module into the
// namespace under a different identifier. They are name-mapping
// declarations, not redundant wrappers — e.g. the
// `prisma-json-types-generator` convention:
//
//   declare global {
//     namespace PrismaJson {
//       type ClaimFlags = TClaimFlags;       // ← required, not redundant
//     }
//   }
function isInsideNamespaceOrAmbient(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    const t = current.type
    if (t === 'internal_module' || t === 'module' || t === 'ambient_declaration') {
      return true
    }
    current = current.parent
  }
  return false
}

export const redundantTypeAliasVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-type-alias',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['type_alias_declaration'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    const typeNode = node.childForFieldName('value')
    if (!nameNode || !typeNode) return null

    if (isInsideNamespaceOrAmbient(node)) return null

    if (typeNode.type === 'type_identifier') {
      if (typeNode.text === nameNode.text) return null
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant type alias',
        `Type alias \`${nameNode.text}\` just wraps \`${typeNode.text}\` without adding meaning.`,
        sourceCode,
        `Use \`${typeNode.text}\` directly, or rename it to convey semantic meaning.`,
      )
    }
    return null
  },
}
