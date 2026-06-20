import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'

/**
 * `sb.Append(x.ToString())` allocates an intermediate string only to hand it to
 * `Append`, which has strongly-typed overloads (`Append(int)`, `Append(double)`,
 * …) that format directly into the buffer. Fires when the single `Append`
 * argument is an argument-less `.ToString()` call.
 */
export const csharpStringBuilderToStringAppendVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/stringbuilder-tostring-append',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'Append') return null
    if (node.childForFieldName('function')?.type !== 'member_access_expression') return null

    const args = getCSharpArguments(node)
    if (args.length !== 1) return null
    const arg = args[0]!
    if (arg.type !== 'invocation_expression') return null
    if (getCSharpMethodName(arg) !== 'ToString') return null
    if (getCSharpArguments(arg).length !== 0) return null
    // Must be a member call `x.ToString()`, not a bare ToString().
    if (arg.childForFieldName('function')?.type !== 'member_access_expression') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'StringBuilder.Append(x.ToString())',
      'Calling ToString() before Append allocates an intermediate string; Append has strongly-typed overloads that format the value straight into the buffer.',
      sourceCode,
      'Drop the ToString() and let Append use its typed overload (Append(x)).',
    )
  },
}
