import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_TYPES, getCSharpFunctionBody, getCSharpFunctionName, isCSharpFunctionBoundary } from './_helpers.js'

// `switch_expression` arms are deliberately NOT counted — a switch expression
// is C#'s declarative lookup-table form (pattern matching), not tangled
// control flow. Statement-form constructs are what cognitive complexity is
// about.
const NESTING_TYPES = new Set([
  'if_statement', 'for_statement', 'foreach_statement', 'while_statement',
  'do_statement', 'switch_statement', 'catch_clause', 'conditional_expression',
])

export const csharpCognitiveComplexityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/cognitive-complexity',
  languages: ['csharp'],
  nodeTypes: CSHARP_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getCSharpFunctionBody(node)
    if (!bodyNode) return null

    let complexity = 0

    function walk(n: SyntaxNode, nesting: number) {
      // Lambda/local-function bodies are their own functions — LINQ chains
      // must not charge complexity to the enclosing method.
      if (isCSharpFunctionBoundary(n.type) && n.id !== node.id) return

      if (NESTING_TYPES.has(n.type)) {
        complexity += 1 + nesting
        // An `else` branch costs +1 (the nested if of an `else if` chain is
        // charged separately when the walk reaches it).
        if (n.type === 'if_statement' && n.childForFieldName('alternative')) {
          complexity += 1
        }
      }
      if (n.type === 'binary_expression') {
        const op = n.childForFieldName('operator')
        if (op?.text === '&&' || op?.text === '||') complexity += 1
      }

      // An `else if` continues the chain at the SAME logical level — don't
      // raise nesting when descending into the alternative's if.
      const nextNesting = NESTING_TYPES.has(n.type) ? nesting + 1 : nesting
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (!child) continue
        if (n.type === 'if_statement' && child.type === 'if_statement'
          && n.childForFieldName('alternative')?.id === child.id) {
          walk(child, nesting)
        } else {
          walk(child, nextNesting)
        }
      }
    }

    walk(bodyNode, 0)

    if (complexity > 15) {
      const name = getCSharpFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'High cognitive complexity',
        `Method \`${name}\` has cognitive complexity ${complexity} (max 15). Simplify by extracting helper methods or reducing nesting.`,
        sourceCode,
        'Break the method into smaller, focused helper methods.',
      )
    }
    return null
  },
}
