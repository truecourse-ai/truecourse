import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

const GENERIC_MESSAGES = [
  'something went wrong',
  'an error occurred',
  'error occurred',
  'internal server error',
  'oops',
  'oops!',
  'try again later',
  'please try again',
]

// Object-literal keys that label a short headline shown to a user.
const TITLE_KEYS = new Set(['title', 'heading', 'header', 'name', 'summary', 'label'])
// Object-literal keys that carry the longer, actionable detail to pair with a title.
const DESCRIPTION_KEYS = new Set([
  'description', 'detail', 'details', 'body', 'subtitle', 'content', 'message',
])

export const genericErrorMessageVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/generic-error-message',
  languages: JS_LANGUAGES,
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text.toLowerCase().replace(/['"` ]/g, '').trim()
    let matched = false
    for (const msg of GENERIC_MESSAGES) {
      if (text === msg.replace(/ /g, '')) {
        matched = true
        break
      }
    }
    if (!matched) return null

    // Toast/notification-style UIs commonly pair a vague title with a useful
    // description in the same object literal (`{ title: 'Something went wrong',
    // description: 'Failed to save…' }`). The user does see actionable detail,
    // so flagging the title is noise. Skip when a sibling description-like
    // property is present.
    if (isLabeledWithDescriptionSibling(node)) return null

    // The same title+detail pairing also appears as JSX attributes
    // (`<ErrorView title="Oops" message={detail} />`). The vague headline is
    // paired with a sibling attribute carrying the actionable detail, so
    // flagging the title alone is noise — mirror the object-literal carve-out.
    if (isJsxTitleWithDescriptionSibling(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Generic error message',
      `Error message "${node.text}" is too vague to be actionable. Include an error code or specific detail to help with debugging.`,
      sourceCode,
      'Replace with a specific error message that includes an error code or actionable detail.',
    )
  },
}

// JSX analogue of isLabeledWithDescriptionSibling: a string that is the value
// of a `title`/`heading`/... JSX attribute whose element also carries a
// `message`/`description`/... attribute. The attribute name is the first named
// child of the `jsx_attribute`; sibling attributes live on the enclosing
// opening / self-closing element.
function isJsxTitleWithDescriptionSibling(node: SyntaxNode): boolean {
  const attr = node.parent
  if (!attr || attr.type !== 'jsx_attribute') return false

  const nameNode = attr.namedChild(0)
  if (!nameNode) return false
  const attrName = nameNode.text.replace(/['"`]/g, '')
  if (!TITLE_KEYS.has(attrName)) return false

  const element = attr.parent
  if (!element) return false

  for (const child of element.namedChildren) {
    if (child.id === attr.id || child.type !== 'jsx_attribute') continue
    const k = child.namedChild(0)
    if (!k) continue
    const kn = k.text.replace(/['"`]/g, '')
    if (DESCRIPTION_KEYS.has(kn)) return true
  }
  return false
}

function isLabeledWithDescriptionSibling(node: SyntaxNode): boolean {
  const pair = findContainingPair(node)
  if (!pair) return false

  const keyNode = pair.childForFieldName('key')
  if (!keyNode) return false
  const keyName = keyNode.text.replace(/['"`]/g, '')
  if (!TITLE_KEYS.has(keyName)) return false

  const obj = pair.parent
  if (!obj || obj.type !== 'object') return false

  for (const child of obj.namedChildren) {
    if (child.id === pair.id || child.type !== 'pair') continue
    const k = child.childForFieldName('key')
    if (!k) continue
    const kn = k.text.replace(/['"`]/g, '')
    if (DESCRIPTION_KEYS.has(kn)) return true
  }
  return false
}

// Walk up until we find a `pair` ancestor where `node` is inside the value
// subtree (not the key subtree). Returns null if the node is a key, or if
// there's no enclosing pair before the function/program boundary.
function findContainingPair(node: SyntaxNode): SyntaxNode | null {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (cur.type === 'pair') {
      const value = cur.childForFieldName('value')
      if (!value) return null
      // Confirm node lives under the value branch.
      let walker: SyntaxNode | null = node
      while (walker && walker.id !== cur.id) {
        if (walker.id === value.id) return cur
        walker = walker.parent
      }
      return null
    }
    cur = cur.parent
  }
  return null
}
