import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * An extension method on `object` attaches to every type in the program, so it
 * pollutes IntelliSense everywhere and is almost always a design mistake. The
 * check fires on a `method_declaration` whose first parameter carries the
 * `this` modifier and is typed `object`.
 */
function extendedTypeIsObject(method: SyntaxNode): boolean {
  const params = method.childForFieldName('parameters')
  const first = params?.namedChildren.find((c) => c?.type === 'parameter')
  if (!first) return false
  const isExtension = first.namedChildren.some((c) => c?.type === 'modifier' && c.text === 'this')
  if (!isExtension) return false
  // The parameter type node is the field `type`; `object` is a predefined_type.
  const typeNode = first.childForFieldName('type')
  return typeNode?.type === 'predefined_type' && typeNode.text === 'object'
}

export const csharpExtensionMethodOnObjectVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/extension-method-on-object',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    if (!extendedTypeIsObject(node)) return null

    const name = node.childForFieldName('name')?.text ?? 'method'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Extension method extends object',
      `Extension method \`${name}\` extends \`object\`, polluting IntelliSense on every type.`,
      sourceCode,
      'Constrain the extension to a more specific type, or make it a regular helper method.',
    )
  },
}
