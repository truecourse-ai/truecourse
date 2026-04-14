import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: Lambda handler writes to /tmp but doesn't clean up

function isLambdaHandler(funcNode: SyntaxNode): boolean {
  const name = funcNode.childForFieldName('name')?.text
  return name === 'lambda_handler' || name === 'handler'
}

function writesToTmp(body: SyntaxNode): boolean {
  let found = false
  function walk(n: SyntaxNode) {
    if (found) return
    if (n.type === 'string') {
      const text = n.text
      if (text.includes('/tmp/') || text === '"/tmp"' || text === "'/tmp'") {
        found = true
        return
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(body)
  return found
}

function cleansTmp(body: SyntaxNode): boolean {
  let cleaned = false
  function walk(n: SyntaxNode) {
    if (cleaned) return
    if (n.type === 'call') {
      const fn = n.childForFieldName('function')
      if (fn) {
        const text = fn.text
        if (text === 'os.remove' || text === 'os.unlink' || text === 'shutil.rmtree' ||
          text === 'os.rmdir' || text === 'glob.glob' || text === 'tempfile.TemporaryFile' ||
          text === 'tempfile.NamedTemporaryFile' || text === 'tempfile.TemporaryDirectory') {
          cleaned = true
          return
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(body)
  return cleaned
}

export const pythonLambdaTmpNotCleanedVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/lambda-tmp-not-cleaned',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    if (!isLambdaHandler(node)) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    if (!writesToTmp(body)) return null
    if (cleansTmp(body)) return null

    const nameNode = node.childForFieldName('name')
    return makeViolation(
      this.ruleKey, nameNode ?? node, filePath, 'medium',
      'Lambda handler not cleaning /tmp',
      `Lambda handler \`${nameNode?.text ?? ''}\` writes to \`/tmp\` but doesn't clean up — Lambda execution environments are reused, so temporary files accumulate across invocations.`,
      sourceCode,
      'Clean up /tmp files using `os.remove()`, `shutil.rmtree()`, or use `tempfile.TemporaryFile` context manager.',
    )
  },
}
