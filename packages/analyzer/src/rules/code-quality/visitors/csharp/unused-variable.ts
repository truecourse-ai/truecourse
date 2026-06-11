import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_METHODLIKE_TYPES, isCSharpFunctionBoundary } from './_helpers.js'

export const csharpUnusedVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-variable',
  languages: ['csharp'],
  nodeTypes: CSHARP_METHODLIKE_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode || bodyNode.type !== 'block') return null

    const declared = new Map<string, SyntaxNode>()
    const read = new Set<string>()

    function collectDeclarations(n: SyntaxNode) {
      // Locals of nested lambdas / local functions belong to them.
      if (isCSharpFunctionBoundary(n.type) && n.id !== node.id) return
      if (n.type === 'local_declaration_statement') {
        // `using var x = …` exists for its disposal side effect.
        const isUsing = n.children.some((c) => c?.type === 'using')
        if (!isUsing) {
          const decl = n.namedChildren.find((c) => c?.type === 'variable_declaration')
          for (const declarator of decl?.namedChildren ?? []) {
            if (declarator?.type !== 'variable_declarator') continue
            const nameNode = declarator.childForFieldName('name')
            if (nameNode?.type === 'identifier') declared.set(nameNode.text, nameNode)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) collectDeclarations(child)
      }
    }

    function collectReads(n: SyntaxNode) {
      if (n.type === 'identifier') {
        const parent = n.parent
        if (parent) {
          // Pure writes are not reads.
          if (parent.type === 'assignment_expression'
            && parent.childForFieldName('left')?.id === n.id
            && parent.childForFieldName('operator')?.text === '=') return
          // The declarator's own name is not a read.
          if (parent.type === 'variable_declarator' && parent.childForFieldName('name')?.id === n.id) return
          // Member names (`order.Status` → `Status`) are not local reads.
          if ((parent.type === 'member_access_expression' || parent.type === 'qualified_name'
            || parent.type === 'member_binding_expression')
            && parent.childForFieldName('name')?.id === n.id) return
          // `foreach (var x in …)` and `out var x` declare, not read.
          if (parent.type === 'foreach_statement' && parent.childForFieldName('left')?.id === n.id) return
          if (parent.type === 'declaration_expression' && parent.childForFieldName('name')?.id === n.id) return
        }
        read.add(n.text)
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) collectReads(child)
      }
    }

    collectDeclarations(bodyNode)
    collectReads(bodyNode)

    for (const [name, nameNode] of declared) {
      if (!read.has(name) && !name.startsWith('_')) {
        return makeViolation(
          this.ruleKey, nameNode, filePath, 'medium',
          'Unused variable',
          `Variable \`${name}\` is declared but never read. Remove it or use the \`_\` discard.`,
          sourceCode,
          'Remove the unused variable or replace it with the `_` discard if the value must be evaluated.',
        )
      }
    }
    return null
  },
}
