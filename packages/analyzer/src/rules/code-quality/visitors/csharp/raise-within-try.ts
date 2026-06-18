import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

function simpleTypeName(typeNode: SyntaxNode | null): string {
  if (!typeNode) return ''
  if (typeNode.type === 'qualified_name') return typeNode.childForFieldName('name')?.text ?? ''
  return typeNode.text
}

interface CatchInfo { type: string | null; hasFilter: boolean; rethrows: boolean }

function analyzeCatch(clause: SyntaxNode): CatchInfo {
  const decl = clause.namedChildren.find((c) => c?.type === 'catch_declaration')
  const type = decl ? simpleTypeName(decl.childForFieldName('type')) : null
  const hasFilter = clause.namedChildren.some((c) => c?.type === 'catch_filter_clause')
  const body = clause.childForFieldName('body')
  let rethrows = false
  function scan(n: SyntaxNode): void {
    if (rethrows) return
    if (n.type === 'throw_statement' || n.type === 'throw_expression') { rethrows = true; return }
    for (const child of n.namedChildren) if (child) scan(child)
  }
  if (body) scan(body)
  return { type, hasFilter, rethrows }
}

/**
 * `throw new X(…)` at the top level of a `try` whose own unfiltered `catch`
 * swallows it (catch-all or exact type match, with no rethrow): the
 * deliberate throw never escapes the method — it's a disguised goto into the
 * catch block. Rethrow patterns (`catch { log; throw; }`) are NOT flagged.
 */
export const csharpRaiseWithinTryVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/raise-within-try',
  languages: ['csharp'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const catches = node.namedChildren
      .filter((c) => c?.type === 'catch_clause')
      .map((c) => analyzeCatch(c!))
      .filter((c) => !c.hasFilter && !c.rethrows)
    if (catches.length === 0) return null

    // Throws anywhere in the try body, except inside nested trys (their own
    // catches own them) and lambdas/local functions (different lifetime).
    const throws: SyntaxNode[] = []
    function collect(n: SyntaxNode): void {
      if (n.type === 'try_statement' || n.type === 'lambda_expression'
        || n.type === 'anonymous_method_expression' || n.type === 'local_function_statement') return
      if (n.type === 'throw_statement') throws.push(n)
      for (const child of n.namedChildren) if (child) collect(child)
    }
    for (const child of body.namedChildren) if (child) collect(child)

    for (const stmt of throws) {
      const creation = stmt.namedChildren.find((c) => c?.type === 'object_creation_expression')
      if (!creation) continue
      const thrown = simpleTypeName(creation.childForFieldName('type'))

      const swallowedBy = catches.find((c) =>
        c.type === null || c.type === 'Exception' || c.type === thrown)
      if (!swallowedBy) continue

      return makeViolation(
        this.ruleKey, stmt, filePath, 'medium',
        'Throw swallowed by own catch',
        `\`throw new ${thrown}(…)\` inside this \`try\` is caught by the same statement's \`catch${swallowedBy.type ? ` (${swallowedBy.type})` : ''}\` and never escapes — a disguised goto.`,
        sourceCode,
        'Move the validation/throw before the try, or narrow the catch so deliberate throws propagate.',
      )
    }
    return null
  },
}
