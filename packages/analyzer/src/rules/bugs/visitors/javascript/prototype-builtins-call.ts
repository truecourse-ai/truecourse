import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES, PROTOTYPE_BUILTINS } from './_helpers.js'

export const prototypeBuiltinsCallVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/prototype-builtins-call',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || !PROTOTYPE_BUILTINS.has(prop.text)) return null

    const obj = fn.childForFieldName('object')
    if (!obj) return null

    // Skip if already called via Object.prototype: Object.prototype.hasOwnProperty.call(obj, key)
    if (obj.type === 'member_expression') {
      const objProp = obj.childForFieldName('property')
      if (objProp?.text === 'call' || objProp?.text === 'apply') return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Prototype builtin called directly',
      `\`${prop.text}()\` is called directly on the object. If the object has a custom \`${prop.text}\` property this will throw. Use \`Object.prototype.${prop.text}.call(${obj.text}, ...)\` instead.`,
      sourceCode,
      `Use \`Object.prototype.${prop.text}.call(obj, ...args)\` for safe access.`,
    )
  },
}
