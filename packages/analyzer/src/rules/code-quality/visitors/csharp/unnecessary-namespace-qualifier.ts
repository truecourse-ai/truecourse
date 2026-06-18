import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A fully qualified reference whose namespace is already imported by a
 * `using` directive in the same file: `using System.Text;` plus
 * `System.Text.StringBuilder` — the qualifier is redundant.
 *
 * Exact, syntactic check: the entire qualifier chain must equal a plain
 * (non-static, non-alias) using target. Known limitation: a qualifier kept
 * deliberately to disambiguate identically named types from two imported
 * namespaces will still be flagged.
 */
export const csharpUnnecessaryNamespaceQualifierVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-namespace-qualifier',
  languages: ['csharp'],
  nodeTypes: ['compilation_unit'],
  visit(node, filePath, sourceCode) {
    const usingTargets = new Set<string>()

    function collectUsings(scope: SyntaxNode) {
      for (const child of scope.namedChildren) {
        if (!child) continue
        if (child.type === 'using_directive') {
          // Skip `using static` (imports type members, qualifiers stay
          // meaningful) and aliases (`using Json = …`).
          if (child.children.some((c) => c?.type === 'static')) continue
          if (child.childForFieldName('name')) continue
          const target = child.namedChildren.find(
            (c) => c && (c.type === 'qualified_name' || c.type === 'identifier'),
          )
          if (target) usingTargets.add(target.text)
        } else if (child.type === 'namespace_declaration') {
          const body = child.namedChildren.find((c) => c?.type === 'declaration_list')
          if (body) collectUsings(body)
        }
      }
    }
    collectUsings(node)
    if (usingTargets.size === 0) return null

    let found: { node: SyntaxNode; prefix: string; rest: string } | null = null

    function walk(n: SyntaxNode) {
      if (found) return
      // The using directives themselves obviously repeat their own target.
      if (n.type === 'using_directive') return

      // Expression context: `System.Text.Json.JsonSerializer.Serialize(…)` —
      // the receiver chain that spells out an imported namespace.
      if (n.type === 'member_access_expression') {
        const receiver = n.childForFieldName('expression')
        if (receiver && (receiver.type === 'identifier' || receiver.type === 'member_access_expression')
          && usingTargets.has(receiver.text)) {
          found = { node: n, prefix: receiver.text, rest: n.childForFieldName('name')?.text ?? '' }
          return
        }
      }

      // Type context: `new System.Text.StringBuilder()`, fields, parameters.
      if (n.type === 'qualified_name') {
        const qualifier = n.childForFieldName('qualifier')
        if (qualifier && usingTargets.has(qualifier.text)) {
          found = { node: n, prefix: qualifier.text, rest: n.childForFieldName('name')?.text ?? '' }
          return
        }
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) walk(child)
      }
    }
    walk(node)

    if (!found) return null
    const { node: refNode, prefix, rest } = found as { node: SyntaxNode; prefix: string; rest: string }
    return makeViolation(
      this.ruleKey, refNode, filePath, 'low',
      'Unnecessary namespace qualifier',
      `\`${prefix}.${rest}\` is fully qualified, but \`using ${prefix};\` already imports the namespace. Drop the \`${prefix}.\` prefix.`,
      sourceCode,
      `Remove the \`${prefix}.\` prefix — the namespace is already imported.`,
    )
  },
}
