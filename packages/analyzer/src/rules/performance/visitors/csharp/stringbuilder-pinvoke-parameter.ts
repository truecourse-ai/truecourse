import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames } from '../../../_shared/csharp-helpers.js'
import { getCSharpSimpleTypeName } from './_helpers.js'

/**
 * A `StringBuilder` parameter on a P/Invoke (`[DllImport]` / `[LibraryImport]`)
 * declaration always marshals through a copied native buffer. A `char` span or
 * buffer avoids that per-call copy. Fires when a P/Invoke method has a parameter
 * whose type's simple name is `StringBuilder`.
 */
const PINVOKE_ATTRIBUTES = new Set(['DllImport', 'LibraryImport'])

function hasStringBuilderParameter(method: SyntaxNode): boolean {
  const params = method.childForFieldName('parameters')
  if (!params) return false
  for (const param of params.namedChildren) {
    if (param?.type !== 'parameter') continue
    const type = param.childForFieldName('type')
    if (type && getCSharpSimpleTypeName(type) === 'StringBuilder') return true
  }
  return false
}

export const csharpStringBuilderPinvokeParameterVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/stringbuilder-pinvoke-parameter',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const attrs = getCSharpAttributeNames(node)
    if (!attrs.some((a) => PINVOKE_ATTRIBUTES.has(a))) return null
    if (!hasStringBuilderParameter(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'StringBuilder parameter on a P/Invoke',
      'Marshalling a StringBuilder across a P/Invoke boundary always copies a native buffer in and out. A char span or buffer avoids the copy.',
      sourceCode,
      'Replace the StringBuilder parameter with a Span<char>/char[] buffer (and a length parameter).',
    )
  },
}
