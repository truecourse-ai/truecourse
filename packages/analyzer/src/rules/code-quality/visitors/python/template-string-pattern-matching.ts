import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects template string processing using if/elif chains that could use
 * structural pattern matching (match/case, Python 3.10+).
 * Heuristic: if an if/elif chain has 3+ branches that all check the same
 * Template/string variable with isinstance or equality checks, suggest pattern matching.
 */

function countBranches(node: SyntaxNode): number {
  // In Python tree-sitter, elif_clause nodes are direct named children of if_statement
  let count = 1 // the initial if
  for (const child of node.namedChildren) {
    if (child.type === 'elif_clause') {
      count++
    }
  }
  return count
}

function checksTemplateOrString(condition: SyntaxNode): boolean {
  const text = condition.text
  // Specifically Template usage: \`Template\` class reference,
  // string Template methods (\`safe_substitute\` / \`substitute\`),
  // or \`isinstance(x, Template)\` / \`isinstance(x, ...Template...)\`.
  // Bare \`isinstance\` matches were too broad — \`isinstance(x, str)\`
  // / \`isinstance(x, MyClass)\` aren't template-string code.
  if (text.includes('.safe_substitute') || text.includes('.substitute')) return true
  if (/\bTemplate\b/.test(text)) return true
  return false
}

export const pythonTemplateStringPatternMatchingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/template-string-pattern-matching',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Only process top-level if statements
    if (node.parent?.type === 'elif_clause' || node.parent?.type === 'else_clause') return null

    // Only flag if we have 3+ branches
    const branchCount = countBranches(node)
    if (branchCount < 3) return null

    const condition = node.childForFieldName('condition')
    if (!condition) return null

    // Check if the condition involves template/string type checking
    if (!checksTemplateOrString(condition)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Template string without pattern matching',
      `if/elif chain with ${branchCount} branches checking template types. Consider using \`match/case\` (Python 3.10+) for cleaner structural pattern matching.`,
      sourceCode,
      'Refactor the if/elif chain to use `match/case` structural pattern matching.',
    )
  },
}
