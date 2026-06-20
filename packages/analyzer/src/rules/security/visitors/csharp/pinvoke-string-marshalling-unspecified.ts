import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributes } from './_helpers.js'

/**
 * A `[DllImport]` P/Invoke that marshals a string without specifying how. When
 * a method has a string-like parameter (string / StringBuilder / char / char[])
 * but the DllImport attribute sets no `CharSet` and the parameter carries no
 * `[MarshalAs]`, the marshaller defaults to ANSI (CharSet.Ansi), which can
 * silently truncate or mis-encode data and, historically, enabled buffer
 * issues. The marshalling should be stated explicitly.
 */
const STRING_PARAM = /^(?:string|System\.String|StringBuilder|System\.Text\.StringBuilder|char)\b/

function paramTypeText(param: SyntaxNode): string {
  const typeNode = param.childForFieldName('type')
    ?? param.namedChildren.find((c) => c && c.type !== 'attribute_list' && c.type !== 'identifier' && c.type !== 'modifier')
    ?? param.namedChildren.find((c) => c?.type === 'predefined_type')
  return typeNode?.text ?? ''
}

function isStringLikeParam(param: SyntaxNode): boolean {
  const type = paramTypeText(param)
  if (STRING_PARAM.test(type)) return true
  return /^char\[\]/.test(type) || type === 'char[]'
}

export const csharpPInvokeStringMarshallingUnspecifiedVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/pinvoke-string-marshalling-unspecified',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const dllImport = getCSharpAttributes(node).find((a) => a.name === 'DllImport')
    if (!dllImport) return null
    // CharSet specified on the DllImport → marshalling is stated.
    if (dllImport.args.some((a) => a.name === 'CharSet')) return null

    const list = node.childForFieldName('parameters') ?? node.namedChildren.find((c) => c?.type === 'parameter_list')
    if (!list) return null
    for (const param of list.namedChildren) {
      if (param?.type !== 'parameter') continue
      if (!isStringLikeParam(param)) continue
      // A parameter-level [MarshalAs] states the marshalling explicitly.
      if (getCSharpAttributes(param).some((a) => a.name === 'MarshalAs')) continue
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'P/Invoke string marshalling unspecified',
        'A [DllImport] with a string parameter sets no CharSet and the parameter has no [MarshalAs], so the marshaller defaults to ANSI, which can mis-encode or truncate data.',
        sourceCode,
        'Set CharSet on the [DllImport] (e.g. CharSet.Unicode) or annotate the parameter with [MarshalAs].',
      )
    }
    return null
  },
}
