import type { CodeRuleVisitor } from '../../../types.js'

export { csharpCommentTagFormattingVisitor } from './comment-tag-formatting.js'
export { csharpWhitespaceFormattingVisitor } from './whitespace-formatting.js'
export { csharpUnnecessaryParenthesesStyleVisitor } from './unnecessary-parentheses-style.js'
export { csharpSortingStyleVisitor } from './sorting-style.js'
export { csharpDocstringCompletenessVisitor } from './docstring-completeness.js'
export { csharpNamingConventionVisitor } from './naming-convention.js'

import { csharpCommentTagFormattingVisitor } from './comment-tag-formatting.js'
import { csharpWhitespaceFormattingVisitor } from './whitespace-formatting.js'
import { csharpUnnecessaryParenthesesStyleVisitor } from './unnecessary-parentheses-style.js'
import { csharpSortingStyleVisitor } from './sorting-style.js'
import { csharpDocstringCompletenessVisitor } from './docstring-completeness.js'
import { csharpNamingConventionVisitor } from './naming-convention.js'

export const STYLE_CSHARP_VISITORS: CodeRuleVisitor[] = [
  csharpCommentTagFormattingVisitor,
  csharpWhitespaceFormattingVisitor,
  csharpUnnecessaryParenthesesStyleVisitor,
  csharpSortingStyleVisitor,
  csharpDocstringCompletenessVisitor,
  csharpNamingConventionVisitor,
]
