import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonImportSources } from '../../../_shared/python-framework-detection.js'

// Detects: synchronous blocking calls inside async functions in a Trio context
// Common trio-specific sync calls that should use async equivalents
const TRIO_SYNC_CALLS = new Map([
  ['time.sleep', 'trio.sleep'],
  ['os.sync', 'await trio.to_thread.run_sync(os.sync)'],
])

const TRIO_SYNC_MODULES = ['time', 'os', 'socket']

export const pythonTrioSyncCallVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/trio-sync-call',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func || func.type !== 'attribute') return null

    const obj = func.childForFieldName('object')
    const attr = func.childForFieldName('attribute')
    if (!obj || !attr) return null

    const fullCall = `${obj.text}.${attr.text}`

    if (!TRIO_SYNC_CALLS.has(fullCall)) return null

    // Check if we're inside an async function by walking up
    let parent = node.parent
    let insideAsync = false
    while (parent) {
      if (parent.type === 'function_definition') {
        const asyncKw = parent.children.find((c) => c.type === 'async')
        if (asyncKw) {
          insideAsync = true
        }
        break
      }
      parent = parent.parent
    }

    if (!insideAsync) return null

    // Check if trio is imported via AST-based import source detection
    const importSources = getPythonImportSources(node)
    const trioImported = [...importSources].some((src) => src === 'trio' || src.startsWith('trio.'))

    if (!trioImported) return null

    const suggested = TRIO_SYNC_CALLS.get(fullCall) ?? 'trio async equivalent'

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Synchronous call in Trio async context',
      `\`${fullCall}()\` is a synchronous blocking call inside an async function — in Trio, this blocks the event loop. Use \`${suggested}\` instead.`,
      sourceCode,
      `Replace \`${fullCall}()\` with \`${suggested}\`.`,
    )
  },
}
