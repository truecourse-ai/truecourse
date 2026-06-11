import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpEnclosingFunction, getCSharpRootNode, hasCSharpModifier, walkCSharp } from '../../../_shared/csharp-helpers.js'

/**
 * Interpolating an object whose class doesn't override ToString —
 * `$"saved {order}"` prints the type name ("Billing.Order"), not the data.
 *
 * PARTIAL (no type checker): only fires when the interpolated identifier's
 * type can be resolved from a local declaration in the same method
 * (`Order order = …` / `var x = new Order()`) AND that type is a class or
 * struct declared in the SAME FILE with no ToString override. Records,
 * partial types and types with a base class are skipped (their ToString may
 * come from elsewhere).
 */
function typesWithoutToString(root: SyntaxNode): Set<string> {
  const names = new Set<string>()
  walkCSharp(root, (n) => {
    if (n.type !== 'class_declaration' && n.type !== 'struct_declaration') return
    if (hasCSharpModifier(n, 'partial')) return
    const name = n.childForFieldName('name')?.text
    const body = n.childForFieldName('body')
    if (!name || !body) return
    // A base class may provide ToString; interface bases (I-prefixed) can't.
    const bases = n.namedChildren.find((c) => c?.type === 'base_list')
    if (bases && bases.namedChildren.some((b) => b && !/^I[A-Z]/.test(b.text.split('.').pop() ?? ''))) return
    const hasToString = body.namedChildren.some(
      (m) => m?.type === 'method_declaration' && m.childForFieldName('name')?.text === 'ToString',
    )
    if (!hasToString) names.add(name)
  })
  return names
}

/** Resolve `identifier` to a declared type name within the enclosing method. */
function localDeclaredType(identifier: SyntaxNode): string | null {
  const fn = getCSharpEnclosingFunction(identifier)
  if (!fn) return null
  let result: string | null = null
  walkCSharp(fn, (n) => {
    if (result || n.type !== 'variable_declaration') return
    const declarator = n.namedChildren.find(
      (c) => c?.type === 'variable_declarator' && c.childForFieldName('name')?.text === identifier.text,
    )
    if (!declarator) return
    const typeNode = n.childForFieldName('type')
    if (typeNode?.type === 'identifier') {
      result = typeNode.text
    } else if (typeNode?.type === 'implicit_type') {
      const init = declarator.namedChildren.find((c) => c?.type === 'object_creation_expression')
      const created = init?.childForFieldName('type')
      if (created?.type === 'identifier') result = created.text
    }
  })
  return result
}

export const csharpBaseToStringVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/base-to-string',
  languages: ['csharp'],
  nodeTypes: ['interpolation'],
  visit(node, filePath, sourceCode) {
    // Format clauses (`{order:N0}`) imply IFormattable — out of scope
    if (node.namedChildren.some((c) => c?.type === 'interpolation_format_clause')) return null
    const expr = node.namedChildren.find(
      (c) => c && c.type !== 'interpolation_format_clause' && c.type !== 'interpolation_alignment_clause' && c.type !== 'interpolation_brace',
    )
    if (expr?.type !== 'identifier') return null

    const typeName = localDeclaredType(expr)
    if (!typeName) return null

    const root = getCSharpRootNode(node)
    if (!typesWithoutToString(root).has(typeName)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Interpolated object has no ToString override',
      `\`{${expr.text}}\` interpolates a \`${typeName}\`, which does not override ToString() — the output is the type name, not the value.`,
      sourceCode,
      `Override ToString() on ${typeName}, or interpolate specific members (e.g. \`{${expr.text}.Id}\`).`,
    )
  },
}
