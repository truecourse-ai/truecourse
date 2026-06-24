import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A property whose `get` only returns a single backing field and whose `set`
 * only assigns `value` to that same field carries no behaviour an auto-property
 * `{ get; set; }` would not — the explicit accessors and backing field are
 * boilerplate. The check fires on a `property_declaration` with both a
 * trivial getter (`return <field>;`) and a trivial setter (`<field> = value;`)
 * over the *same* field. Any extra statement (validation, change notification,
 * logging) means the accessors do real work and the property is left alone.
 */
function trivialGetField(accessor: SyntaxNode): string | null {
  const block = accessor.namedChildren.find((c) => c?.type === 'block')
  // expression-bodied: `get => _f;`
  const arrow = accessor.namedChildren.find((c) => c?.type === 'arrow_expression_clause')
  if (arrow && !block) {
    const expr = arrow.namedChildren[0]
    return expr?.type === 'identifier' ? expr.text : null
  }
  if (!block) return null
  const stmts = block.namedChildren.filter((c) => c && c.type !== 'comment')
  if (stmts.length !== 1 || stmts[0]!.type !== 'return_statement') return null
  const value = stmts[0]!.namedChildren[0]
  return value?.type === 'identifier' ? value.text : null
}

function trivialSetField(accessor: SyntaxNode): string | null {
  const block = accessor.namedChildren.find((c) => c?.type === 'block')
  const arrow = accessor.namedChildren.find((c) => c?.type === 'arrow_expression_clause')
  const expr = arrow
    ? arrow.namedChildren[0]
    : (() => {
        if (!block) return null
        const stmts = block.namedChildren.filter((c) => c && c.type !== 'comment')
        if (stmts.length !== 1 || stmts[0]!.type !== 'expression_statement') return null
        return stmts[0]!.namedChildren[0] ?? null
      })()
  if (expr?.type !== 'assignment_expression') return null
  if (expr.childForFieldName('operator')?.text !== '=') return null
  const lhs = expr.childForFieldName('left')
  const rhs = expr.childForFieldName('right')
  if (lhs?.type !== 'identifier') return null
  if (rhs?.type !== 'identifier' || rhs.text !== 'value') return null
  return lhs.text
}

export const csharpUseAutoPropertyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/use-auto-property',
  languages: ['csharp'],
  nodeTypes: ['property_declaration'],
  visit(node, filePath, sourceCode) {
    const accessorList = node.namedChildren.find((c) => c?.type === 'accessor_list')
    if (!accessorList) return null

    let getField: string | null = null
    let setField: string | null = null
    let accessorCount = 0
    for (const accessor of accessorList.namedChildren) {
      if (accessor?.type !== 'accessor_declaration') continue
      accessorCount++
      const kind = accessor.children[0]?.text
      if (kind === 'get') getField = trivialGetField(accessor)
      else if (kind === 'set') setField = trivialSetField(accessor)
      else return null // init/unknown accessor → leave alone
    }
    if (accessorCount !== 2) return null
    if (!getField || !setField || getField !== setField) return null

    const name = node.childForFieldName('name')?.text ?? 'property'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Non-auto trivial property',
      `Property \`${name}\` only reads and writes a single backing field — it can be an auto-property \`{ get; set; }\`.`,
      sourceCode,
      'Replace the explicit accessors and backing field with an auto-property.',
    )
  },
}
