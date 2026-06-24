import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Right-most simple name of an attribute's identifier/qualified name. */
function attributeName(attr: SyntaxNode): string {
  const name = attr.childForFieldName('name') ?? attr.namedChildren[0]
  if (!name) return ''
  const text = name.text
  return text.includes('.') ? text.slice(text.lastIndexOf('.') + 1) : text
}

/**
 * A parameter marked `[Optional]` that is also declared `ref` or `out`. The
 * `[Optional]` attribute makes a parameter omissible by C# callers, but the
 * compiler forbids omitting a `ref`/`out` argument — so the attribute is a
 * no-op that misleads readers into thinking the argument can be skipped. Either
 * the parameter should not be `ref`/`out`, or the `[Optional]` marker should be
 * removed.
 */
export const csharpOptionalOnRefOutParameterVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/optional-on-ref-out-parameter',
  languages: ['csharp'],
  nodeTypes: ['parameter'],
  visit(node, filePath, sourceCode) {
    const passModifier = node.children.find(
      (c) => c?.type === 'modifier' && (c.text === 'ref' || c.text === 'out'),
    )
    if (!passModifier) return null

    const optionalAttr = node.namedChildren.some(
      (list) =>
        list?.type === 'attribute_list' &&
        list.namedChildren.some(
          (a) =>
            a?.type === 'attribute' &&
            (attributeName(a) === 'Optional' || attributeName(a) === 'OptionalAttribute'),
        ),
    )
    if (!optionalAttr) return null

    const paramName = node.childForFieldName('name')?.text
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      '[Optional] on a ref/out parameter',
      `Parameter \`${paramName ?? '?'}\` is marked \`[Optional]\` but is \`${passModifier.text}\`; the compiler forbids omitting a ${passModifier.text} argument, so the attribute is a no-op that misleads callers.`,
      sourceCode,
      'Remove `[Optional]`, or drop the `ref`/`out` modifier if the argument really is optional.',
    )
  },
}
