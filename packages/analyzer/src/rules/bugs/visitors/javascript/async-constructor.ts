import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const asyncConstructorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/async-constructor',
  languages: JS_LANGUAGES,
  nodeTypes: ['method_definition'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name || name.text !== 'constructor') return null

    const isAsync = node.children.some((c) => c.text === 'async')
    if (isAsync) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Async constructor',
        'Constructors cannot be `async` — the `async` keyword is ignored and the constructor always returns a plain object synchronously.',
        sourceCode,
        'Use a static async factory method instead: `static async create() { const instance = new MyClass(); await instance.init(); return instance; }`.',
      )
    }
    return null
  },
}
