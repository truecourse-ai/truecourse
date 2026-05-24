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
const SEMANTIC_ALIAS_SUFFIX = /(?:Props|State|Settings|Options|Config|Context|Value|Data|Result|Response|Request|Action|Event|Handler|Provider)$/

function hasSemanticSuffix(name: string): boolean {
  return SEMANTIC_ALIAS_SUFFIX.test(name)
}

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

      // Exported aliases are semantic re-exports — the alias name is the
      // public API of this module and exists to give consumers a stable
      // import (e.g. `export type DocumentEmailSettings = TDocumentEmailSettings`).
      // Collapsing to the source name would force every consumer to import
      // through a deeper path, so the rename is meaningful, not redundant.
      if (node.parent?.type === 'export_statement') return null

      // React / TS structural-role suffixes (Props, State, Settings, ...)
      // signal that the alias gives a domain-specific role to a generic
      // type. The rename adds meaning even if the alias is local; flagging
      // it adds noise without surfacing real cleanup wins.
      if (hasSemanticSuffix(nameNode.text)) return null

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
