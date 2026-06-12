import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Write-only property: a `set` (or `init`) accessor with no `get`. The C#
 * form of the setter-without-getter defect — CA1044 "Properties should not
 * be write-only": callers can store a value they can never observe.
 */
export const csharpAccessorPairsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/accessor-pairs',
  languages: ['csharp'],
  nodeTypes: ['property_declaration'],
  visit(node, filePath, sourceCode) {
    const accessorList = node.namedChildren.find((c) => c?.type === 'accessor_list')
    if (!accessorList) return null

    let hasGet = false
    let hasSet = false
    for (const accessor of accessorList.namedChildren) {
      if (accessor?.type !== 'accessor_declaration') continue
      const kind = accessor.children[0]?.text
      if (kind === 'get') hasGet = true
      if (kind === 'set' || kind === 'init') hasSet = true
    }

    if (!hasSet || hasGet) return null

    const name = node.childForFieldName('name')?.text ?? 'property'
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Write-only property',
      `Property \`${name}\` has a setter but no getter — callers can store a value they can never read back (CA1044).`,
      sourceCode,
      `Add a \`get\` accessor to \`${name}\`, or replace the write-only property with a method like \`Set${name}(...)\`.`,
    )
  },
}
