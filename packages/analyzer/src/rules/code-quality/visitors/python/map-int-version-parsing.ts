import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonMapIntVersionParsingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/map-int-version-parsing',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Detect: map(int, something.split("."))
    const fn = node.childForFieldName('function')
    if (!fn || fn.text !== 'map') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    if (argList.length < 2) return null

    const firstArg = argList[0]
    if (!firstArg || firstArg.type !== 'identifier' || firstArg.text !== 'int') return null

    const secondArg = argList[1]
    if (!secondArg || secondArg.type !== 'call') return null

    const splitFn = secondArg.childForFieldName('function')
    if (!splitFn || splitFn.type !== 'attribute') return null

    const splitAttr = splitFn.childForFieldName('attribute')
    if (!splitAttr || splitAttr.text !== 'split') return null

    const splitArgs = secondArg.childForFieldName('arguments')
    if (!splitArgs) return null

    const splitArg = splitArgs.namedChildren[0]
    if (!splitArg || splitArg.type !== 'string') return null

    const splitChar = splitArg.text
    if (splitChar !== '"."' && splitChar !== "'.'") return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Version string parsing with map(int)',
      '`map(int, version.split("."))` is fragile version parsing — use `sys.version_info` or the `packaging` library.',
      sourceCode,
      'Use `sys.version_info` for Python version, or `packaging.version.parse()` for package versions.',
    )
  },
}
