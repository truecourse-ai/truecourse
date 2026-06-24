import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * C# requires `==`/`!=` and `<`/`>` to be declared in pairs to compile, so the
 * common real-world asymmetry is `<`/`>` defined without `<=`/`>=` (which the
 * compiler does NOT force). The rule fires on a relational operator overload
 * whose required complement-pair partner (`<` with `<=`, `>` with `>=`) is
 * missing on the same type, leaving an inconsistent comparison surface.
 */

const PARTNER: Record<string, string> = {
  '<': '<=',
  '<=': '<',
  '>': '>=',
  '>=': '>',
}

function declaredOperators(typeBody: SyntaxNode): Set<string> {
  const ops = new Set<string>()
  for (const member of typeBody.namedChildren) {
    if (member?.type !== 'operator_declaration') continue
    const sym = member.childForFieldName('operator')?.text
    if (sym) ops.add(sym)
  }
  return ops
}

export const csharpAsymmetricEqualityOperatorsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/asymmetric-equality-operators',
  languages: ['csharp'],
  nodeTypes: ['operator_declaration'],
  visit(node, filePath, sourceCode) {
    const sym = node.childForFieldName('operator')?.text
    if (!sym || !(sym in PARTNER)) return null

    const typeBody = node.parent
    if (typeBody?.type !== 'declaration_list') return null

    const ops = declaredOperators(typeBody)
    const partner = PARTNER[sym]
    if (ops.has(partner)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Asymmetric comparison operators',
      `The \`${sym}\` operator is overloaded without its complement \`${partner}\`, leaving the comparison surface inconsistent.`,
      sourceCode,
      `Also overload the \`${partner}\` operator so the comparison pair is symmetric.`,
    )
  },
}
