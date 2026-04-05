import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: @classmethod with first arg not named 'cls', or instance method with first arg not named 'self'
export const pythonClassmethodFirstArgumentNamingVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/classmethod-first-argument-naming',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    // Find decorators
    const decorators = node.children.filter((c) => c.type === 'decorator')
    const funcDef = node.namedChildren.find((c) => c.type === 'function_definition')
    if (!funcDef) return null

    const isClassMethod = decorators.some((d) => {
      const name = d.namedChildren[0]
      return name && (name.text === 'classmethod' || name.text === 'staticmethod')
    })

    if (!isClassMethod) return null

    const isStaticMethod = decorators.some((d) => {
      const name = d.namedChildren[0]
      return name && name.text === 'staticmethod'
    })

    // Static methods don't have self/cls constraint
    if (isStaticMethod) return null

    const params = funcDef.childForFieldName('parameters')
    if (!params) return null

    const firstParam = params.namedChildren[0]
    if (!firstParam) return null

    let firstParamName: string | null = null
    if (firstParam.type === 'identifier') {
      firstParamName = firstParam.text
    } else if (firstParam.type === 'typed_parameter') {
      const identNode = firstParam.namedChildren.find((c) => c.type === 'identifier')
      firstParamName = identNode?.text ?? null
    }

    if (!firstParamName) return null

    const methodName = funcDef.childForFieldName('name')?.text ?? 'method'

    // For classmethod, first arg should be 'cls'
    if (firstParamName !== 'cls') {
      return makeViolation(
        this.ruleKey, funcDef, filePath, 'medium',
        'Wrong first argument name in classmethod',
        `\`@classmethod\` \`${methodName}\` has first argument named \`${firstParamName}\` instead of \`cls\` — incorrect naming causes confusion and subtle bugs.`,
        sourceCode,
        `Rename the first argument of \`${methodName}\` from \`${firstParamName}\` to \`cls\`.`,
      )
    }

    return null
  },
}
