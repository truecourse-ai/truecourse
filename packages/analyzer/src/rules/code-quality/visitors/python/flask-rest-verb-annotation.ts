import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonFlaskRestVerbAnnotationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/flask-rest-verb-annotation',
  languages: ['python'],
  nodeTypes: ['decorator'],
  visit(node, filePath, sourceCode) {
    // Detect @app.route(...) without HTTP method specified — encourage specific methods
    for (const child of node.namedChildren) {
      if (child.type !== 'call') continue

      const fn = child.childForFieldName('function')
      if (!fn || fn.type !== 'attribute') continue

      const attr = fn.childForFieldName('attribute')
      if (!attr || attr.text !== 'route') continue

      // Check if methods= is specified
      const args = child.childForFieldName('arguments')
      if (!args) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Flask route without HTTP verb',
          '`@app.route()` should use a specific HTTP verb decorator: `@app.get()`, `@app.post()`, etc.',
          sourceCode,
          'Replace `@app.route(path)` with `@app.get(path)` or appropriate HTTP method decorator.',
        )
      }

      const hasMethods = args.namedChildren.some((a) => {
        if (a.type === 'keyword_argument') {
          return a.childForFieldName('name')?.text === 'methods'
        }
        return false
      })

      if (!hasMethods) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Flask route without HTTP verb',
          '`@app.route()` without `methods=` should use a specific HTTP verb decorator.',
          sourceCode,
          'Replace with `@app.get()`, `@app.post()`, etc., or add `methods=[...]` to `@app.route()`.',
        )
      }
    }

    return null
  },
}
