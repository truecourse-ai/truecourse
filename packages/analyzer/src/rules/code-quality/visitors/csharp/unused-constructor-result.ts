import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Statement-position `new Foo(…);` — the constructed object is discarded.
 * Either the call is dead, or the type does real work in its constructor
 * (which the discard hides). Constructions handing results back through
 * `ref`/`out` arguments are excluded.
 */
export const csharpUnusedConstructorResultVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-constructor-result',
  languages: ['csharp'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (expr?.type !== 'object_creation_expression') return null

    // `new Mutex(true, name, out var createdNew);` — the result channel is the out arg.
    const args = expr.childForFieldName('arguments')
    if (args?.namedChildren.some((a) => a?.children.some((c) => c?.type === 'out' || c?.type === 'ref'))) return null

    const typeNode = expr.childForFieldName('type')
    const typeName = typeNode?.text ?? 'object'

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unused constructor result',
      `\`new ${typeName}(…)\` result is discarded — if construction is needed only for a side effect, the intent is invisible at the call site.`,
      sourceCode,
      'Assign the instance to a variable, or extract the side effect into a named method.',
    )
  },
}
