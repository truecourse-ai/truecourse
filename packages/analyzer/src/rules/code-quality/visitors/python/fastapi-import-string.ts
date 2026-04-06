import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects uvicorn.run() or similar ASGI runners with reload=True, debug=True,
 * or workers > 1 where the app is passed as a direct object instead of an import string.
 */
export const pythonFastapiImportStringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/fastapi-import-string',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // uvicorn.run() or gunicorn app:app pattern
    let isUvicornRun = false
    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if (obj?.text === 'uvicorn' && attr?.text === 'run') isUvicornRun = true
    } else if (fn.type === 'identifier' && fn.text === 'run') {
      // Could be uvicorn.run imported directly
      isUvicornRun = true
    }

    if (!isUvicornRun) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argNodes = args.namedChildren
    if (argNodes.length === 0) return null

    // First arg should be the app — check if it's a string
    const firstArg = argNodes[0]
    if (firstArg.type === 'string') return null // already a string — correct

    // Check if reload, debug, or workers kwarg is present
    const kwargs = argNodes.filter((c) => c.type === 'keyword_argument')
    const kwNames = kwargs.map((c) => c.childForFieldName('name')?.text)
    const hasReloadOrDebug = kwNames.includes('reload') || kwNames.includes('debug') || kwNames.includes('workers')
    if (!hasReloadOrDebug) return null

    // First arg is not a string — flag it
    const appName = firstArg.text

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'FastAPI app not passed as import string',
      `\`uvicorn.run(${appName}, ...)\` with reload/debug/workers — pass the app as an import string like \`"module:app"\` to enable proper reloading.`,
      sourceCode,
      'Change to `uvicorn.run("module:app", ...)` using the import string format.',
    )
  },
}
