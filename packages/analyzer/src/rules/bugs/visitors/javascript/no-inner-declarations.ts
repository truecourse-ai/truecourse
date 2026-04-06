import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const noInnerDeclarationsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/no-inner-declarations',
  languages: JS_LANGUAGES,
  nodeTypes: ['function_declaration', 'variable_declaration'],
  visit(node, filePath, sourceCode) {
    // Only flag if the parent is a block that's inside if/else/while/for/etc (not a function body or module)
    const parent = node.parent
    if (!parent || parent.type !== 'statement_block') return null

    const grandparent = parent.parent
    if (!grandparent) return null

    // Flag if inside if/else/while/for/do blocks — not top-level function bodies
    const BLOCK_CONTAINERS = new Set([
      'if_statement', 'else_clause', 'while_statement', 'for_statement',
      'for_in_statement', 'do_statement', 'try_statement', 'catch_clause',
    ])

    if (!BLOCK_CONTAINERS.has(grandparent.type)) return null

    if (node.type === 'function_declaration') {
      const name = node.childForFieldName('name')
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Function declaration in block',
        `Function \`${name?.text ?? ''}\` is declared inside a block. Hoisting behavior varies across environments.`,
        sourceCode,
        'Move the function declaration to the outer scope or use a function expression assigned to a `let`/`const`.',
      )
    }

    if (node.type === 'variable_declaration') {
      // Only flag `var`, not `let` or `const`
      const hasVar = node.children.some((c) => c.text === 'var')
      if (!hasVar) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'var declaration in block',
        '`var` inside a block is hoisted to the function scope, which can cause confusing behavior.',
        sourceCode,
        'Use `let` or `const` inside blocks instead of `var`.',
      )
    }

    return null
  },
}
