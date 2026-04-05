import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects variables named with _ prefix (indicating they're unused/dummy)
 * but actually referenced in code — the naming is misleading.
 * RUF052: UsedDummyVariable.
 *
 * We detect the simplest case: a variable starting with _ that is referenced
 * in expressions (not just assigned to).
 */
export const pythonUsedDummyVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/used-dummy-variable',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    const body = node.childForFieldName('body')
    if (!params || !body) return null

    // Find parameters that start with _ (but not __ dunder or just _)
    const dummyParams: string[] = []
    for (const param of params.namedChildren) {
      let name: string | undefined
      if (param.type === 'identifier') name = param.text
      else if (param.type === 'typed_parameter' || param.type === 'default_parameter' || param.type === 'typed_default_parameter') {
        name = param.childForFieldName('name')?.text
      }

      if (!name) continue
      // Starts with _ but not __ and not just _
      if (name.startsWith('_') && name !== '_' && !name.startsWith('__')) {
        dummyParams.push(name)
      }
    }

    if (dummyParams.length === 0) return null

    // Check if any dummy param is referenced in the body
    const bodyText = body.text

    for (const param of dummyParams) {
      // Simple text search — look for the param name used as an identifier
      // We need it to appear as a word boundary
      const re = new RegExp(`\\b${param}\\b`)
      if (re.test(bodyText)) {
        return makeViolation(
          this.ruleKey, node.childForFieldName('name') ?? node, filePath, 'medium',
          'Used dummy variable',
          `Parameter \`${param}\` starts with \`_\` indicating it is unused, but it is referenced in the function body. Either remove the \`_\` prefix or don't use the variable.`,
          sourceCode,
          `Rename \`${param}\` to \`${param.replace(/^_+/, '')}\` since it is actually used.`,
        )
      }
    }

    return null
  },
}
