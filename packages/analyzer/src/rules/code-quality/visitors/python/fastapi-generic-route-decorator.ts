import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonFastapiGenericRouteDecoratorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/fastapi-generic-route-decorator',
  languages: ['python'],
  nodeTypes: ['decorator'],
  visit(node, filePath, sourceCode) {
    // Detect @app.api_route(...) or @router.api_route(...)
    for (const child of node.namedChildren) {
      if (child.type !== 'call') continue

      const fn = child.childForFieldName('function')
      if (!fn || fn.type !== 'attribute') continue

      const attr = fn.childForFieldName('attribute')
      if (!attr || attr.text !== 'api_route') continue

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'FastAPI generic route decorator',
        '`@app.api_route()` should use a specific HTTP method decorator: `@app.get()`, `@app.post()`, etc.',
        sourceCode,
        'Replace `@app.api_route(path, methods=["GET"])` with `@app.get(path)`.',
      )
    }

    return null
  },
}
