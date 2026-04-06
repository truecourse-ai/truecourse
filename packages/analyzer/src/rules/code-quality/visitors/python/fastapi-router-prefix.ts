import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonFastapiRouterPrefixVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/fastapi-router-prefix',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Detect app.include_router(router, prefix="/api") — prefix should be on APIRouter init
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr || attr.text !== 'include_router') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const key = arg.childForFieldName('name')
        if (key?.text === 'prefix') {
          return makeViolation(
            this.ruleKey, arg, filePath, 'low',
            'Router prefix not at initialization',
            '`prefix` should be defined in `APIRouter(prefix=...)` during initialization, not when including.',
            sourceCode,
            'Move the `prefix` argument to `APIRouter(prefix=...)` constructor.',
          )
        }
      }
    }

    return null
  },
}
