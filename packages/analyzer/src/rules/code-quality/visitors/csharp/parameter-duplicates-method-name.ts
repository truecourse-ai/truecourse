import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A parameter whose name matches its enclosing method's name (case-insensitively)
 * is almost always a copy-paste artifact and reads confusingly at the call site.
 * The check fires on a `method_declaration` with a `parameter` whose identifier
 * equals the method name.
 */
export const csharpParameterDuplicatesMethodNameVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/parameter-duplicates-method-name',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const methodName = node.childForFieldName('name')?.text
    if (!methodName) return null

    const params = node.childForFieldName('parameters')
    if (!params) return null
    for (const param of params.namedChildren) {
      if (param?.type !== 'parameter') continue
      const pName = param.childForFieldName('name')?.text
      if (pName && pName.toLowerCase() === methodName.toLowerCase()) {
        return makeViolation(
          this.ruleKey, param, filePath, 'low',
          'Parameter duplicates the method name',
          `Parameter \`${pName}\` has the same name as its method \`${methodName}\` — likely a copy-paste artifact.`,
          sourceCode,
          'Rename the parameter to describe the value it carries.',
        )
      }
    }
    return null
  },
}
