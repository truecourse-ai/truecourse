import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Application.* calls that mark a method as the WinForms message-loop entry point.
const WINFORMS_BOOTSTRAP = /\bApplication\s*\.\s*(Run|EnableVisualStyles|SetCompatibleTextRenderingDefault|SetHighDpiMode)\b/

/**
 * A Windows Forms <c>Main</c> entry point that is not marked <c>[STAThread]</c>. WinForms
 * relies on a single-threaded apartment: without <c>[STAThread]</c> the clipboard, common
 * dialogs, drag-and-drop and COM-based controls misbehave or throw at runtime. Detected
 * structurally — a <c>Main</c> method whose body starts the WinForms message loop
 * (<c>Application.Run</c>/<c>EnableVisualStyles</c>/…) — so no reference assemblies are
 * needed.
 */
export const csharpWinFormsMissingSTAThreadVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/winforms-missing-stathread',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('name')?.text !== 'Main') return null
    const body = node.childForFieldName('body')
    if (!body || !WINFORMS_BOOTSTRAP.test(body.text)) return null
    if (attributeNames(node).includes('STAThread')) return null

    const name = node.childForFieldName('name')
    return makeViolation(
      this.ruleKey, name ?? node, filePath, 'medium',
      'WinForms entry point missing [STAThread]',
      'This WinForms Main entry point starts the message loop but is not marked [STAThread]; without it the clipboard, common dialogs, and COM controls can fail at runtime.',
      sourceCode,
      'Add the [STAThread] attribute to the Main method.',
    )
  },
}

function attributeNames(node: SyntaxNode): string[] {
  const names: string[] = []
  for (const child of node.children) {
    if (child?.type !== 'attribute_list') continue
    for (const attr of child.namedChildren) {
      if (attr?.type !== 'attribute') continue
      const n = attr.childForFieldName('name')?.text
      if (n) names.push((n.split('.').pop() ?? n).replace(/Attribute$/, ''))
    }
  }
  return names
}
