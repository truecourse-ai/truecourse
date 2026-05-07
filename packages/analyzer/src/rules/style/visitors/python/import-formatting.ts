import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonImportFormattingVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/import-formatting',
  languages: ['python'],
  nodeTypes: ['import_statement', 'import_from_statement'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (!parent || parent.type !== 'module') return null

    // Honor `# noqa: E402` and bare `# noqa` markers on the import line —
    // the developer explicitly acknowledged the deviation. Files like
    // `alembic/env.py`, `saas_server.py` (after `load_dotenv()`), and
    // `app.py` (after `warnings.catch_warnings()`) all carry these.
    const lines = sourceCode.split('\n')
    const importLine = lines[node.startPosition.row] ?? ''
    if (/#\s*noqa\b/.test(importLine)) return null

    let sawNonImport = false
    let docstringSeen = false
    for (const child of parent.namedChildren) {
      if (child?.id === node.id) {
        if (sawNonImport) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Import not at top of file',
            'Import statement found after non-import code. Group all imports at the top of the module.',
            sourceCode,
            'Move this import to the top of the file with the other imports.',
          )
        }
        return null
      }

      // Pure-prologue node types — never count as "non-import code":
      //   - import_statement / import_from_statement / future_import_statement
      //     are imports themselves
      //   - comment covers shebang, encoding (`# -*- coding: utf-8 -*-`),
      //     `# pyright:` / `# mypy:` / `# type:` directives
      if (
        child.type === 'import_statement' ||
        child.type === 'import_from_statement' ||
        child.type === 'future_import_statement' ||
        child.type === 'comment'
      ) continue

      // Module docstring — first string expression statement. Allow
      // anywhere in the prologue (before or after comment-style
      // directives).
      if (!docstringSeen && child.type === 'expression_statement') {
        const firstChild = child.namedChildren[0]
        if (firstChild?.type === 'string') {
          docstringSeen = true
          continue
        }
      }

      // `if TYPE_CHECKING:` blocks — canonical Python typing idiom for
      // forward-reference imports. The block contains only imports
      // and is conventionally placed BETWEEN runtime imports.
      if (child.type === 'if_statement') {
        const cond = child.childForFieldName('condition')
        if (cond && /\bTYPE_CHECKING\b/.test(cond.text)) continue
      }

      // `try: import X except ImportError:` blocks — common idiom for
      // optional dependencies. The body's first statement is an import
      // and the except handler typically rebinds the name.
      if (child.type === 'try_statement') {
        const body = child.childForFieldName('body')
        if (body) {
          const firstBodyChild = body.namedChildren[0]
          if (
            firstBodyChild?.type === 'import_statement' ||
            firstBodyChild?.type === 'import_from_statement'
          ) continue
        }
      }

      sawNonImport = true
    }

    return null
  },
}
