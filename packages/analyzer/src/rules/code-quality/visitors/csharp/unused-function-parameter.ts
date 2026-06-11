import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * Unused method parameter. Signature-constrained methods are skipped:
 * overrides, virtual/abstract/partial/extern members, explicit interface
 * implementations, `Main`, and the `(object sender, EventArgs e)` event
 * handler shape. Lambdas are never checked — delegate signatures routinely
 * force unused parameters.
 */
export const csharpUnusedFunctionParameterVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-function-parameter',
  languages: ['csharp'],
  nodeTypes: ['method_declaration', 'constructor_declaration', 'local_function_statement'],
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params || params.namedChildCount === 0) return null

    const body = node.childForFieldName('body')
    if (!body) return null
    // An empty body is an intentional stub.
    if (body.type === 'block' && body.namedChildCount === 0) return null
    // `throw new NotImplementedException()` stubs keep their signature.
    if (/NotImplementedException|NotSupportedException/.test(body.text)) return null
    // No-op implementations (`return Task.CompletedTask;`) keep the
    // interface's signature deliberately.
    if (body.type === 'block' && body.namedChildCount === 1
      && body.namedChildren[0]?.type === 'return_statement'
      && /Task\.CompletedTask|Task\.FromResult|ValueTask\.CompletedTask/.test(body.namedChildren[0].text)) {
      return null
    }

    if (node.type === 'method_declaration') {
      for (const mod of ['override', 'virtual', 'abstract', 'partial', 'extern']) {
        if (hasCSharpModifier(node, mod)) return null
      }
      // Explicit interface implementation: `void IHandler.Handle(Msg m)`.
      if (node.namedChildren.some((c) => c?.type === 'explicit_interface_specifier')) return null
      if (node.childForFieldName('name')?.text === 'Main') return null
    }

    const paramList: Array<{ name: string; node: SyntaxNode }> = []
    for (const param of params.namedChildren) {
      if (!param || param.type !== 'parameter') continue
      // Extension-method receiver (`this IGuardClause guardClause`) — the
      // parameter IS the extension point; being unread in the body is normal.
      if (param.children.some((c) => c?.type === 'this' || (c?.type === 'modifier' && c.text === 'this'))) continue
      // CancellationToken parameters are interface/convention contracts
      // (MediatR handlers, hosted services) — removing one breaks the
      // signature, and accepting-but-not-observing it is ubiquitous.
      if (param.childForFieldName('type')?.text === 'CancellationToken') continue
      const nameNode = param.childForFieldName('name')
      if (nameNode?.type === 'identifier') paramList.push({ name: nameNode.text, node: param })
    }
    if (paramList.length === 0) return null

    // Event-handler shape: (object sender, XxxEventArgs e).
    if (paramList.length === 2) {
      const first = params.namedChildren.find((c) => c?.type === 'parameter')
      const firstType = first?.childForFieldName('type')?.text
      const secondType = paramList[1] ? paramList[1].node.childForFieldName('type')?.text : undefined
      if ((firstType === 'object' || firstType === 'object?') && secondType?.endsWith('EventArgs')) return null
    }

    // Collect identifier usages in the body and the constructor initializer
    // (`: base(logger)`), excluding member-name positions (`x.flag`).
    const used = new Set<string>()
    function collectReads(n: SyntaxNode) {
      if (n.type === 'identifier') {
        const parent = n.parent
        const isMemberName = parent
          && (parent.type === 'member_access_expression' || parent.type === 'qualified_name'
            || parent.type === 'member_binding_expression')
          && parent.childForFieldName('name')?.id === n.id
        if (!isMemberName) used.add(n.text)
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) collectReads(child)
      }
    }
    collectReads(body)
    const initializer = node.namedChildren.find((c) => c?.type === 'constructor_initializer')
    if (initializer) collectReads(initializer)

    for (const { name, node: paramNode } of paramList) {
      if (name.startsWith('_')) continue
      if (!used.has(name)) {
        return makeViolation(
          this.ruleKey, paramNode, filePath, 'low',
          `Unused parameter \`${name}\``,
          `Parameter \`${name}\` is never used in the method body. Remove it or rename it to \`_\` if the signature is fixed.`,
          sourceCode,
          `Remove unused parameter \`${name}\` or rename it to \`_${name}\`.`,
        )
      }
    }
    return null
  },
}
