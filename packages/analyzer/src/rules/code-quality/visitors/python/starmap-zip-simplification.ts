import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonStarmapZipSimplificationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/starmap-zip-simplification',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Detect: itertools.starmap(f, zip(a, b)) or starmap(f, zip(a, b))
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let isStarmap = false
    if (fn.type === 'identifier' && fn.text === 'starmap') {
      isStarmap = true
    } else if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr?.text === 'starmap') isStarmap = true
    }

    if (!isStarmap) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    if (argList.length !== 2) return null

    const secondArg = argList[1]
    if (!secondArg || secondArg.type !== 'call') return null

    const zipFn = secondArg.childForFieldName('function')
    if (!zipFn || zipFn.text !== 'zip') return null

    const funcArg = argList[0]?.text ?? 'f'
    const zipArgs = secondArg.childForFieldName('arguments')
    const zipArgList = zipArgs?.namedChildren ?? []
    const zipArgsStr = zipArgList.map((a) => a.text).join(', ')

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'starmap(f, zip(a, b)) simplification',
      `\`starmap(${funcArg}, zip(${zipArgsStr}))\` can be simplified to \`map(${funcArg}, ${zipArgsStr})\`.`,
      sourceCode,
      `Replace with \`map(${funcArg}, ${zipArgsStr})\`.`,
    )
  },
}
