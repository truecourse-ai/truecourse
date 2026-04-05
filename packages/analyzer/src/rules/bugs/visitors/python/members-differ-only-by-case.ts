import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: two members in same class differing only by case
// e.g., getValue and getvalue in the same class
export const pythonMembersDifferOnlyByCaseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/members-differ-only-by-case',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const memberNames: Array<{ name: string; node: import('tree-sitter').SyntaxNode }> = []

    for (const stmt of body.namedChildren) {
      if (stmt.type === 'function_definition' || stmt.type === 'decorated_definition') {
        const funcDef = stmt.type === 'decorated_definition'
          ? stmt.namedChildren.find((c) => c.type === 'function_definition')
          : stmt
        if (!funcDef) continue
        const nameNode = funcDef.childForFieldName('name')
        if (nameNode) {
          memberNames.push({ name: nameNode.text, node: funcDef })
        }
      }
    }

    // Find pairs that differ only by case
    const seen = new Map<string, string>()
    for (const { name, node: memberNode } of memberNames) {
      const lower = name.toLowerCase()
      if (seen.has(lower) && seen.get(lower) !== name) {
        const other = seen.get(lower)!
        return makeViolation(
          this.ruleKey, memberNode, filePath, 'medium',
          'Members differ only by capitalization',
          `\`${name}\` and \`${other}\` differ only by case — this is confusing and error-prone.`,
          sourceCode,
          'Rename one of the members to be clearly distinct.',
        )
      }
      seen.set(lower, name)
    }

    return null
  },
}
