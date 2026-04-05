import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonPropertyParamCountWrongVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/property-param-count-wrong',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    const decorators = node.namedChildren.filter((c) => c.type === 'decorator')
    const funcDef = node.namedChildren.find((c) => c.type === 'function_definition')
    if (!funcDef) return null

    const params = funcDef.childForFieldName('parameters')
    if (!params) return null

    // Count parameters (excluding *args and **kwargs for this check)
    const paramCount = params.namedChildren.filter((c) =>
      c.type !== 'comment' && c.text !== '*' && !c.text.startsWith('**')
    ).length

    for (const dec of decorators) {
      const decExpr = dec.namedChildren[0]
      if (!decExpr) continue

      // Check for @property
      if (decExpr.type === 'identifier' && decExpr.text === 'property') {
        if (paramCount !== 1) {
          const funcName = funcDef.childForFieldName('name')?.text ?? 'property'
          return makeViolation(
            this.ruleKey, funcDef, filePath, 'high',
            'Property getter with wrong parameter count',
            `\`@property\` getter \`${funcName}\` has ${paramCount} parameter(s) but should have exactly 1 (\`self\`).`,
            sourceCode,
            `Define the getter as \`def ${funcName}(self):\`.`,
          )
        }
      }

      // Check for @xxx.setter
      if (decExpr.type === 'attribute') {
        const attr = decExpr.childForFieldName('attribute')
        if (attr?.text === 'setter' && paramCount !== 2) {
          const funcName = funcDef.childForFieldName('name')?.text ?? 'setter'
          return makeViolation(
            this.ruleKey, funcDef, filePath, 'high',
            'Property setter with wrong parameter count',
            `\`@${decExpr.text}\` setter \`${funcName}\` has ${paramCount} parameter(s) but should have exactly 2 (\`self\`, \`value\`).`,
            sourceCode,
            `Define the setter as \`def ${funcName}(self, value):\`.`,
          )
        }
        if (attr?.text === 'deleter' && paramCount !== 1) {
          const funcName = funcDef.childForFieldName('name')?.text ?? 'deleter'
          return makeViolation(
            this.ruleKey, funcDef, filePath, 'high',
            'Property deleter with wrong parameter count',
            `\`@${decExpr.text}\` deleter \`${funcName}\` has ${paramCount} parameter(s) but should have exactly 1 (\`self\`).`,
            sourceCode,
            `Define the deleter as \`def ${funcName}(self):\`.`,
          )
        }
      }
    }
    return null
  },
}
