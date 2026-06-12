import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_TYPES, getCSharpFunctionBody, getCSharpFunctionName, isCSharpFunctionBoundary } from './_helpers.js'

const DECISION_TYPES = new Set([
  'if_statement', 'for_statement', 'foreach_statement', 'while_statement',
  'do_statement', 'catch_clause', 'conditional_expression',
])

export const csharpCyclomaticComplexityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/cyclomatic-complexity',
  languages: ['csharp'],
  nodeTypes: CSHARP_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getCSharpFunctionBody(node)
    if (!bodyNode) return null

    let complexity = 1

    function walk(n: SyntaxNode) {
      if (isCSharpFunctionBoundary(n.type) && n.id !== node.id) return
      if (DECISION_TYPES.has(n.type)) complexity++
      // Each `case …:` section is a branch; `default:` is the fall-through
      // path already counted in the base complexity. `switch_expression`
      // arms are NOT counted — pattern-matching expressions are C#'s
      // declarative lookup-table form, not imperative branching.
      if (n.type === 'switch_section' && n.children.some((c) => c?.type === 'case')) complexity++
      if (n.type === 'binary_expression') {
        const op = n.childForFieldName('operator')
        if (op?.text === '&&' || op?.text === '||') complexity++
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (complexity > 10) {
      const name = getCSharpFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'High cyclomatic complexity',
        `Method \`${name}\` has cyclomatic complexity ${complexity} (max 10). Consider splitting into smaller methods.`,
        sourceCode,
        'Reduce decision points by extracting logic into helper methods or using lookup tables.',
      )
    }
    return null
  },
}
