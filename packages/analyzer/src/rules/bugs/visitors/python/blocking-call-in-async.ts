import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Blocking calls: open(), time.sleep(), requests.*, subprocess.*
const BLOCKING_CALLS = new Set([
  'open', 'time.sleep', 'requests.get', 'requests.post', 'requests.put', 'requests.delete',
  'requests.patch', 'requests.head', 'requests.request', 'requests.Session',
  'subprocess.run', 'subprocess.call', 'subprocess.check_call', 'subprocess.check_output',
  'subprocess.Popen', 'os.system', 'urllib.request.urlopen',
])

const BLOCKING_MODULES = new Set(['requests', 'subprocess', 'urllib'])

function isInsideAsyncDef(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'function_definition') {
      // Check if it has 'async' keyword
      const firstChild = current.children[0]
      if (firstChild?.type === 'async') return true
      return false
    }
    current = current.parent
  }
  return false
}

export const pythonBlockingCallInAsyncVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/blocking-call-in-async',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    if (!isInsideAsyncDef(node)) return null

    const fn = node.childForFieldName('function')
    if (!fn) return null

    let callName = ''
    if (fn.type === 'identifier') {
      callName = fn.text
    } else if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if (obj && attr) {
        callName = `${obj.text}.${attr.text}`
        // Also check nested: requests.Session().get etc
        if (BLOCKING_MODULES.has(obj.text)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Blocking call in async function',
            `\`${callName}()\` is a synchronous blocking call inside an async function — it will block the event loop. Use an async alternative (e.g. \`httpx\`, \`asyncio\`).`,
            sourceCode,
            'Replace with an async equivalent: use `httpx` instead of `requests`, `asyncio.subprocess` instead of `subprocess`.',
          )
        }
      }
    }

    if (BLOCKING_CALLS.has(callName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Blocking call in async function',
        `\`${callName}()\` is a synchronous blocking call inside an async function — it will block the event loop.`,
        sourceCode,
        'Replace with an async equivalent or wrap with `asyncio.to_thread()`.',
      )
    }

    return null
  },
}
