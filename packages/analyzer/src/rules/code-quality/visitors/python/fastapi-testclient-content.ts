import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects TestClient requests using `data` parameter for bytes/text instead of `content`.
 */
export const pythonFastapiTestclientContentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/fastapi-testclient-content',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (!attr || !obj) return null

    const method = attr.text
    if (!['post', 'put', 'patch'].includes(method)) return null

    // Check if the object is a TestClient instance
    const objText = obj.text
    if (!objText.includes('client') && !objText.includes('Client')) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const kwargs = args.namedChildren.filter((c) => c.type === 'keyword_argument')
    const kwNames = kwargs.map((c) => c.childForFieldName('name')?.text)

    if (!kwNames.includes('data')) return null

    const dataArg = kwargs.find((c) => c.childForFieldName('name')?.text === 'data')
    const dataValue = dataArg?.childForFieldName('value')
    if (!dataValue) return null

    // Check if data value is bytes or a string (not dict/form data)
    const dataText = dataValue.text
    if (dataText.startsWith('b"') || dataText.startsWith("b'") || dataText.startsWith('"') || dataText.startsWith("'")) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'TestClient wrong parameter for raw content',
        `TestClient \`${method}()\` uses \`data=\` for raw bytes/text — use \`content=\` parameter instead for raw content.`,
        sourceCode,
        'Replace `data=` with `content=` for raw bytes or text content.',
      )
    }

    return null
  },
}
