import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

// Return the single executable statement in a branch body, or null if the
// branch is empty or contains more than one statement.
function singleStmt(branch: SyntaxNode | null | undefined): SyntaxNode | null {
  if (!branch) return null
  if (branch.type !== 'statement_block') {
    // Brace-less consequence: branch is the statement itself.
    return branch
  }
  const stmts = branch.namedChildren.filter((c) => c && c.type !== 'comment')
  if (stmts.length !== 1) return null
  return stmts[0] ?? null
}

// A "simple" returned value: literal, identifier, member access, or unary on
// such — i.e. no function calls, spreads, method chains, or computed work.
// Returning a computed expression usually signals branches doing distinct
// substantive work, which is not a readability anti-pattern.
function isSimpleReturnValue(node: SyntaxNode | null | undefined): boolean {
  if (!node) return true // bare `return;`
  switch (node.type) {
    case 'number':
    case 'string':
    case 'template_string':
    case 'true':
    case 'false':
    case 'null':
    case 'undefined':
    case 'identifier':
    case 'this':
      return true
    case 'member_expression':
    case 'subscript_expression': {
      // Simple property access on a simple base.
      const obj = node.childForFieldName('object')
      return isSimpleReturnValue(obj)
    }
    case 'unary_expression': {
      const arg = node.childForFieldName('argument') ?? node.namedChildren[0]
      return isSimpleReturnValue(arg)
    }
    case 'parenthesized_expression':
      return isSimpleReturnValue(node.namedChildren[0])
    default:
      return false
  }
}

export const negatedConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/negated-condition',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    const elsePart = node.children.find((c) => c.type === 'else_clause')
    if (!condition || !elsePart) return null

    const inner = condition.type === 'parenthesized_expression' ? condition.namedChildren[0] : condition
    if (!inner || inner.type !== 'unary_expression') return null
    const op = inner.childForFieldName('operator') ?? inner.children[0]
    if (!op || op.text !== '!') return null

    const elseBody = elsePart.namedChildren[0]
    if (elseBody?.type === 'if_statement') return null

    // Restrict to clear-cut anti-patterns:
    //   1. Bare `return;` / `return <simple>;` / `throw …;` in the if-branch
    //      (redundant else after early-exit).
    //   2. Both branches are single `return <simple-value>;` statements
    //      (mirror returns of literals/identifiers — pure readability swap).
    // Anything else (multi-statement branches, computed returns, distinct
    // side-effect calls, push to different collections) signals genuinely
    // asymmetric logic where negation is intentional.
    const ifBranch = node.childForFieldName('consequence')
    const ifStmt = singleStmt(ifBranch)
    const elseStmt = singleStmt(elseBody)

    let qualifies = false

    // Case 1: if-branch is an early-exit (return or throw).
    if (ifStmt) {
      if (ifStmt.type === 'return_statement') {
        const retVal = ifStmt.namedChildren[0]
        if (isSimpleReturnValue(retVal)) {
          qualifies = true
        }
      } else if (ifStmt.type === 'throw_statement') {
        qualifies = true
      }
    }

    // Case 2: both branches are single simple returns.
    if (!qualifies && ifStmt && elseStmt &&
        ifStmt.type === 'return_statement' && elseStmt.type === 'return_statement') {
      const ifRet = ifStmt.namedChildren[0]
      const elseRet = elseStmt.namedChildren[0]
      if (isSimpleReturnValue(ifRet) && isSimpleReturnValue(elseRet)) {
        qualifies = true
      }
    }

    if (!qualifies) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Negated condition with else',
      'Condition is negated but has an else block. Invert the condition and swap the branches for better readability.',
      sourceCode,
      'Invert the condition and swap the if/else bodies.',
    )
  },
}
