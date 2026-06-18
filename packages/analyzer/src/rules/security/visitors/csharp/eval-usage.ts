import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, isPlainStringLiteral, lastSegment } from './_helpers.js'

/**
 * Roslyn scripting as eval: CSharpScript.EvaluateAsync/RunAsync/Create with a
 * non-literal script string compiles and runs dynamically built C# code. A
 * constant script literal is a deliberate scripting-engine use and is not
 * flagged.
 */
const SCRIPT_METHODS = new Set(['EvaluateAsync', 'RunAsync', 'Create'])

export const csharpEvalUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/eval-usage',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getCSharpMethodName(node)
    if (!SCRIPT_METHODS.has(methodName)) return null
    if (lastSegment(getCSharpReceiver(node)) !== 'CSharpScript') return null

    const args = getCallArgs(node)
    const codeArg = args.find((a) => a.name === 'code') ?? args[0]
    if (!codeArg) return null
    if (isPlainStringLiteral(codeArg.value)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Dynamic code evaluation',
      `CSharpScript.${methodName}() compiles and executes a dynamically built code string. This allows arbitrary code execution.`,
      sourceCode,
      'Do not compile runtime-assembled code. Use a restricted expression evaluator or a fixed set of operations.',
    )
  },
}
