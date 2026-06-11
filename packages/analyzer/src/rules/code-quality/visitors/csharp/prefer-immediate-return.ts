import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `var result = expr; return result;` as the final two statements of a block
 * — return the expression directly. Owns the C# shape for BOTH
 * prefer-immediate-return and unnecessary-assign-before-return (identical
 * defect in C#; the latter is dispositioned to this visitor).
 */
export const csharpPreferImmediateReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-immediate-return',
  languages: ['csharp'],
  nodeTypes: ['block'],
  visit(node, filePath, sourceCode) {
    const stmts = node.namedChildren.filter((c) => c && c.type !== 'comment')
    if (stmts.length < 2) return null

    const last = stmts[stmts.length - 1]
    const secondLast = stmts[stmts.length - 2]
    if (last?.type !== 'return_statement') return null
    if (secondLast?.type !== 'local_declaration_statement') return null
    // `using var x = …; return x;` — the using scope disposes x; removing the
    // declaration changes (broken) semantics rather than style. Leave it to
    // dedicated resource rules.
    if (secondLast.children.some((c) => c?.type === 'using')) return null

    const returned = last.namedChildren[0]
    if (returned?.type !== 'identifier') return null

    const varDecl = secondLast.namedChildren.find((c) => c?.type === 'variable_declaration')
    const declarators = varDecl?.namedChildren.filter((c) => c?.type === 'variable_declarator') ?? []
    if (declarators.length !== 1) return null
    const declarator = declarators[0]!
    if (declarator.childForFieldName('name')?.text !== returned.text) return null
    // Must actually have an initializer.
    if (!declarator.children.some((c) => c?.type === '=')) return null

    return makeViolation(
      this.ruleKey, secondLast, filePath, 'low',
      'Prefer immediate return',
      `Variable \`${returned.text}\` is declared and immediately returned — return the expression directly.`,
      sourceCode,
      `Replace \`var ${returned.text} = expr; return ${returned.text};\` with \`return expr;\`.`,
    )
  },
}
