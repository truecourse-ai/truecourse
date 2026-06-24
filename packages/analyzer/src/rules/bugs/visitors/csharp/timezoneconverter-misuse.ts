import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A <c>TimeZoneInfo.FindSystemTimeZoneById(...)</c> call fed a <c>TZConvert</c>
 * conversion of the time zone id. Since .NET 6, <c>FindSystemTimeZoneById</c> accepts
 * both IANA and Windows time zone ids directly and converts internally, so wrapping the
 * id in TimeZoneConverter (<c>TZConvert.IanaToWindows</c>/<c>WindowsToIana</c>/…) first is
 * redundant work and an extra dependency. Detected by the <c>TZConvert</c> receiver, so
 * no reference assemblies are needed.
 */
export const csharpTimeZoneConverterMisuseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/timezoneconverter-misuse',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression' || fn.childForFieldName('name')?.text !== 'FindSystemTimeZoneById') return null

    const arg = firstArgValue(node)
    if (arg?.type !== 'invocation_expression') return null
    const innerFn = arg.childForFieldName('function')
    if (innerFn?.type !== 'member_access_expression') return null
    if (innerFn.childForFieldName('expression')?.text !== 'TZConvert') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Redundant TimeZoneConverter conversion',
      'TimeZoneInfo.FindSystemTimeZoneById accepts both IANA and Windows time zone ids directly since .NET 6; converting with TZConvert first is redundant.',
      sourceCode,
      'Pass the time zone id straight to FindSystemTimeZoneById and drop the TZConvert conversion.',
    )
  },
}

/** The value expression of the first argument of an invocation. */
function firstArgValue(node: SyntaxNode): SyntaxNode | null {
  const argList = node.childForFieldName('arguments')
  const arg = argList?.namedChildren.find((a) => a?.type === 'argument')
  if (!arg) return null
  const named = arg.namedChildren.filter((c): c is SyntaxNode => c !== null)
  return named.length ? named[named.length - 1] : null
}
