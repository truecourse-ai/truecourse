import type { CodeRuleVisitor } from '../../../types.js'

export { pythonImportFormattingVisitor } from './import-formatting.js'
export { pythonImplicitStringConcatVisitor } from './implicit-string-concatenation.js'
export { pythonCommentTagFormattingVisitor } from './comment-tag-formatting.js'
export { pytestDecoratorStyleVisitor } from './pytest-decorator-style.js'
export { pythonNamingConventionVisitor } from './python-naming-convention.js'
export { pythonDocstringCompletenessVisitor } from './docstring-completeness.js'
export { pythonMinorStyleVisitor } from './python-minor-style-preference.js'
export { pythonWhitespaceFormattingVisitor } from './whitespace-formatting.js'
export { pythonUnnecessaryParenthesesStyleVisitor } from './unnecessary-parentheses-style.js'

import { pythonImportFormattingVisitor } from './import-formatting.js'
import { pythonImplicitStringConcatVisitor } from './implicit-string-concatenation.js'
import { pythonCommentTagFormattingVisitor } from './comment-tag-formatting.js'
import { pytestDecoratorStyleVisitor } from './pytest-decorator-style.js'
import { pythonNamingConventionVisitor } from './python-naming-convention.js'
import { pythonDocstringCompletenessVisitor } from './docstring-completeness.js'
import { pythonMinorStyleVisitor } from './python-minor-style-preference.js'
import { pythonWhitespaceFormattingVisitor } from './whitespace-formatting.js'
import { pythonUnnecessaryParenthesesStyleVisitor } from './unnecessary-parentheses-style.js'

export const STYLE_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonImportFormattingVisitor,
  pythonImplicitStringConcatVisitor,
  pythonCommentTagFormattingVisitor,
  pytestDecoratorStyleVisitor,
  pythonNamingConventionVisitor,
  pythonDocstringCompletenessVisitor,
  pythonMinorStyleVisitor,
  pythonWhitespaceFormattingVisitor,
  pythonUnnecessaryParenthesesStyleVisitor,
]
