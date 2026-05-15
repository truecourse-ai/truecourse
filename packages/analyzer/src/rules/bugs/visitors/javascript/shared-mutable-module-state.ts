import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detect: module-level let/var declarations with mutable types (object, array)
// These are shared across all requests in server contexts

function isModuleLevel(node: SyntaxNode): boolean {
  // Only flag EXPORTED mutable declarations. Module-private mutable state used
  // through a controlled accessor (singleton pattern, store + dispatch) is
  // common and intentional — the danger of shared state arises when external
  // code can mutate it directly.
  const parent = node.parent
  if (!parent) return false
  return parent.type === 'export_statement' && parent.parent?.type === 'program'
}

function isMutableInit(node: SyntaxNode): boolean {
  return node.type === 'object' || node.type === 'array' || node.type === 'new_expression'
}

export const sharedMutableModuleStateVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/shared-mutable-module-state',
  languages: JS_LANGUAGES,
  nodeTypes: ['lexical_declaration', 'variable_declaration'],
  visit(node, filePath, sourceCode) {
    if (!isModuleLevel(node)) return null

    // Check if it's let or var (not const)
    const kindChild = node.children[0]
    if (!kindChild || kindChild.text === 'const') return null

    // Look for declarators with object/array initializers
    for (const child of node.namedChildren) {
      if (child.type !== 'variable_declarator') continue
      const value = child.childForFieldName('value')
      if (value && isMutableInit(value)) {
        const nameNode = child.childForFieldName('name')
        const name = nameNode?.text ?? 'variable'
        return makeViolation(
          this.ruleKey, child, filePath, 'high',
          'Shared mutable state in module scope',
          `\`${name}\` is a mutable ${kindChild.text} declared at module level — in server environments this state is shared across all requests, causing race conditions.`,
          sourceCode,
          'Move mutable state inside request handlers, or use const with immutable patterns.',
        )
      }
    }
    return null
  },
}
