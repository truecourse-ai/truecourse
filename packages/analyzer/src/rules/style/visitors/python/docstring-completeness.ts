import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDocstringCompletenessVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/docstring-completeness',
  languages: ['python'],
  nodeTypes: ['function_definition', 'class_definition'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name) return null

    // Skip private functions
    if (name.text.startsWith('_')) return null

    // Only flag top-level or class-level definitions
    const parent = node.parent
    if (!parent) return null
    if (parent.type !== 'module' && parent.type !== 'block') return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if first statement is a string expression (docstring)
    const firstStmt = body.namedChildren[0]
    if (!firstStmt) return null

    const isDocstring =
      firstStmt.type === 'expression_statement' &&
      firstStmt.namedChildren[0]?.type === 'string'

    if (!isDocstring) {
      const kind = node.type === 'class_definition' ? 'Class' : 'Function'
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        `${kind} missing docstring`,
        `Public ${kind.toLowerCase()} '${name.text}' has no docstring.`,
        sourceCode,
        `Add a docstring: def ${name.text}(...):\n    """Description."""`,
      )
    }

    return null
  },
}
