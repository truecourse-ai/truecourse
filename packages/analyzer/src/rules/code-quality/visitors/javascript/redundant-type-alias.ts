import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Built-in wrapper / global types that genuinely add no value when aliased.
// Aliasing user-defined types is a normal decoupling/naming idiom and is not
// flagged here — only bare aliases over these globals are reported.
const REDUNDANT_TARGETS = new Set([
  'String',
  'Number',
  'Boolean',
  'Object',
  'Symbol',
  'BigInt',
  'Function',
  'Array',
])

export const redundantTypeAliasVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-type-alias',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['type_alias_declaration'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    const typeNode = node.childForFieldName('value')
    if (!nameNode || !typeNode) return null

    if (typeNode.type !== 'type_identifier') return null
    if (typeNode.text === nameNode.text) return null

    // Generic aliases like `type ElementRef<T> = HTMLElement` are not redundant —
    // the type parameter is part of the contract even if it is unused here.
    if (node.childForFieldName('type_parameters')) return null

    // Exported aliases are public API decoupling — `export type Foo = Bar` lets
    // consumers depend on the alias name instead of the internal type.
    if (node.parent?.type === 'export_statement') return null

    // Only flag bare aliases over built-in wrapper/global types. Aliasing
    // user-defined types is normal naming/decoupling, not a redundancy.
    if (!REDUNDANT_TARGETS.has(typeNode.text)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Redundant type alias',
      `Type alias \`${nameNode.text}\` just wraps \`${typeNode.text}\` without adding meaning.`,
      sourceCode,
      `Use \`${typeNode.text}\` directly, or rename it to convey semantic meaning.`,
    )
  },
}
