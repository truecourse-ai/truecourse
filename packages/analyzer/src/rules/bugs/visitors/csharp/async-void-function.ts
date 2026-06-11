import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * `async void` methods — exceptions escape directly onto the synchronization
 * context (crashing the process) and callers cannot await or observe
 * completion. Return `Task` instead.
 *
 * NOT flagged (the documented legitimate uses of async void):
 *   - event-handler signatures `(object sender, …EventArgs e)`
 *   - overrides (UI lifecycle methods like `override async void OnAppearing`
 *     have a void base signature that cannot be changed)
 */
export const csharpAsyncVoidFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/async-void-function',
  languages: ['csharp'],
  nodeTypes: ['method_declaration', 'local_function_statement'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'async')) return null
    if (node.childForFieldName('returns')?.text !== 'void') return null
    if (hasCSharpModifier(node, 'override')) return null

    const params = node.childForFieldName('parameters')?.namedChildren.filter((c) => c?.type === 'parameter') ?? []
    if (params.length === 2) {
      const firstType = params[0]!.childForFieldName('type')?.text
      const secondType = params[1]!.childForFieldName('type')?.text ?? ''
      if (firstType === 'object' && secondType.endsWith('EventArgs')) return null
    }

    const name = node.childForFieldName('name')?.text ?? '<anonymous>'
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'async void method',
      `\`${name}\` is async void — exceptions thrown inside it cannot be caught by callers and will crash the process; completion cannot be awaited.`,
      sourceCode,
      `Change the return type to Task: \`async Task ${name}(...)\`. Reserve async void for event handlers.`,
    )
  },
}
