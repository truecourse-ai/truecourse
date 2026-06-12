import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_REGEX_NODE_TYPES, getCSharpRegexUsage } from './_regex-helpers.js'

export const csharpRegexUnusedGroupVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-unused-group',
  languages: ['csharp'],
  nodeTypes: CSHARP_REGEX_NODE_TYPES,
  visit(node, filePath, sourceCode) {
    const usage = getCSharpRegexUsage(node)
    if (!usage) return null

    // .NET named groups: (?<name>…) or (?'name'…).
    const namedGroups: string[] = []
    const namedGroupRegex = /\(\?[<']([a-zA-Z_][a-zA-Z0-9_]*)[>']/g
    let m: RegExpExecArray | null
    while ((m = namedGroupRegex.exec(usage.pattern)) !== null) {
      namedGroups.push(m[1]!)
    }
    if (namedGroups.length === 0) return null

    // A [GeneratedRegex] pattern's groups are consumed wherever the partial
    // method is called — the whole file is the visibility scope.
    let scope: SyntaxNode | null = node.parent
    while (scope && scope.type !== 'class_declaration' && scope.type !== 'compilation_unit') {
      scope = scope.parent
    }
    const scopeText = scope?.text ?? ''

    for (const groupName of namedGroups) {
      // Groups["name"] / Groups[@"name"] — conservatively, any string
      // occurrence of the name counts as a use.
      const used = scopeText.includes(`"${groupName}"`)
      if (!used) {
        return makeViolation(
          this.ruleKey, usage.patternNode, filePath, 'low',
          'Unused named capture group',
          `Named capture group \`(?<${groupName}>...)\` is never referenced in the code.`,
          sourceCode,
          `Reference the group via \`match.Groups["${groupName}"]\` or convert to a non-capturing group \`(?:...)\`.`,
        )
      }
    }
    return null
  },
}
