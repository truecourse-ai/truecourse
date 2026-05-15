import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const uselessConstructorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-constructor',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['method_definition'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    if (nameNode?.text !== 'constructor') return null

    // Private/protected constructors are intentional (singleton, abstract base,
    // factory-only construction) — the constructor's purpose is access control,
    // not body-level work. Removing it would change visibility semantics.
    const hasAccessibilityModifier = node.children.some(
      (c) => c.type === 'accessibility_modifier' && (c.text === 'private' || c.text === 'protected'),
    )
    if (hasAccessibilityModifier) return null

    const body = node.namedChildren.find((c) => c.type === 'statement_block')
    if (!body) return null

    const stmts = body.namedChildren
    if (stmts.length !== 1) return null

    const stmt = stmts[0]
    if (stmt.type !== 'expression_statement') return null

    const expr = stmt.namedChildren[0]
    if (!expr || expr.type !== 'call_expression') return null

    const fn = expr.childForFieldName('function')
    if (!fn) return null

    if (fn.type !== 'super') return null

    const params = node.childForFieldName('parameters')
    const args = expr.childForFieldName('arguments')

    if (!params || !args) return null

    // TS parameter properties (e.g. `constructor(public code: string) {}`) declare
    // a class field as a side effect of the parameter — removing the constructor
    // would erase that field, so this is not a useless forwarding pattern.
    const hasParameterProperty = params.namedChildren.some((p) =>
      p.children.some((c) => c.type === 'accessibility_modifier' || c.type === 'readonly'),
    )
    if (hasParameterProperty) return null

    const paramTexts = params.namedChildren.map((p) => {
      const n = p.childForFieldName('pattern') ?? p
      return n.text
    })
    const argTexts = args.namedChildren.map((a) => a.text)

    if (JSON.stringify(paramTexts) === JSON.stringify(argTexts)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Useless constructor',
        'This constructor only calls `super()` with the same arguments — it can be removed.',
        sourceCode,
        'Remove the constructor — the parent class constructor will be called automatically.',
      )
    }
    return null
  },
}
