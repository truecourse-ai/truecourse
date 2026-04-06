import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getRegexSource } from './_helpers.js'

export const regexUnusedGroupVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-unused-group',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const src = getRegexSource(node)
    if (!src) return null

    const namedGroups: string[] = []
    const namedGroupRegex = /\(\?<([a-zA-Z_][a-zA-Z0-9_]*)>/g
    let m: RegExpExecArray | null
    while ((m = namedGroupRegex.exec(src)) !== null) {
      namedGroups.push(m[1])
    }
    if (namedGroups.length === 0) return null

    let scope = node.parent
    while (scope && scope.type !== 'statement_block' && scope.type !== 'program') {
      scope = scope.parent
    }
    const scopeText = scope?.text ?? ''

    for (const groupName of namedGroups) {
      const used = scopeText.includes(`.groups.${groupName}`)
        || scopeText.includes(`groups["${groupName}"]`)
        || scopeText.includes(`groups['${groupName}']`)
        || scopeText.includes(`{ ${groupName} }`)
        || scopeText.includes(`{${groupName}}`)
      if (!used) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Unused named capture group',
          `Named capture group \`(?<${groupName}>...)\` is never referenced in the code.`,
          sourceCode,
          `Reference the group via \`match.groups.${groupName}\` or convert to a non-capturing group \`(?:...)\`.`,
        )
      }
    }
    return null
  },
}
