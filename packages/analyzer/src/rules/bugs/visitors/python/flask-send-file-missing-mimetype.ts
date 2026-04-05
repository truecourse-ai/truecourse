import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: send_file(file_obj) without mimetype= or download_name= keyword argument

function isFileObj(node: SyntaxNode): boolean {
  // Heuristic: not a string literal (string = file path, which auto-detects mimetype)
  return node.type !== 'string'
}

export const pythonFlaskSendFileMissingMimetypeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/flask-send-file-missing-mimetype',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    const fnText = fn.text
    if (fnText !== 'send_file' && !fnText.endsWith('.send_file')) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const positionalArgs = args.namedChildren.filter(c => c.type !== 'keyword_argument' && c.type !== 'comment')
    if (positionalArgs.length === 0) return null

    const firstArg = positionalArgs[0]
    if (!isFileObj(firstArg)) return null

    // Check for mimetype= or download_name= kwarg
    const kwArgs = args.namedChildren.filter(c => c.type === 'keyword_argument')
    const hasMimetype = kwArgs.some(k => {
      const name = k.childForFieldName('name')?.text
      return name === 'mimetype' || name === 'download_name'
    })

    if (!hasMimetype) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Flask send_file without mimetype',
        `\`send_file()\` with a file-like object requires either \`mimetype=\` or \`download_name=\` — without it, Flask cannot determine the content type.`,
        sourceCode,
        'Add `mimetype="application/octet-stream"` or a specific MIME type, or pass `download_name="filename.ext"`.',
      )
    }
    return null
  },
}
