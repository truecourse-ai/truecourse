import type { CodeRuleVisitor } from '../../../types.js'

export { csharpCommentTagFormattingVisitor } from './comment-tag-formatting.js'
export { csharpWhitespaceFormattingVisitor } from './whitespace-formatting.js'
export { csharpUnnecessaryParenthesesStyleVisitor } from './unnecessary-parentheses-style.js'
export { csharpSortingStyleVisitor } from './sorting-style.js'
export { csharpDocstringCompletenessVisitor } from './docstring-completeness.js'
export { csharpNamingConventionVisitor } from './naming-convention.js'
export { csharpBuiltinTypeAliasVisitor } from './builtin-type-alias.js'
export { csharpEnumNameRedundantSuffixVisitor } from './enum-name-redundant-suffix.js'
export { csharpEnumNamingConventionVisitor } from './enum-naming-convention.js'
export { csharpFieldKeywordConflictVisitor } from './field-keyword-conflict.js'
export { csharpFlagsEnumZeroNotNoneVisitor } from './flags-enum-zero-not-none.js'
export { csharpLoggerFieldNamingVisitor } from './logger-field-naming.js'
export { csharpScopedIdentifierEscapeVisitor } from './scoped-identifier-escape.js'
export { csharpTypeNameSuffixConventionVisitor } from './type-name-suffix-convention.js'

import { csharpCommentTagFormattingVisitor } from './comment-tag-formatting.js'
import { csharpWhitespaceFormattingVisitor } from './whitespace-formatting.js'
import { csharpUnnecessaryParenthesesStyleVisitor } from './unnecessary-parentheses-style.js'
import { csharpSortingStyleVisitor } from './sorting-style.js'
import { csharpDocstringCompletenessVisitor } from './docstring-completeness.js'
import { csharpNamingConventionVisitor } from './naming-convention.js'
import { csharpBuiltinTypeAliasVisitor } from './builtin-type-alias.js'
import { csharpEnumNameRedundantSuffixVisitor } from './enum-name-redundant-suffix.js'
import { csharpEnumNamingConventionVisitor } from './enum-naming-convention.js'
import { csharpFieldKeywordConflictVisitor } from './field-keyword-conflict.js'
import { csharpFlagsEnumZeroNotNoneVisitor } from './flags-enum-zero-not-none.js'
import { csharpLoggerFieldNamingVisitor } from './logger-field-naming.js'
import { csharpScopedIdentifierEscapeVisitor } from './scoped-identifier-escape.js'
import { csharpTypeNameSuffixConventionVisitor } from './type-name-suffix-convention.js'

export const STYLE_CSHARP_VISITORS: CodeRuleVisitor[] = [
  csharpCommentTagFormattingVisitor,
  csharpWhitespaceFormattingVisitor,
  csharpUnnecessaryParenthesesStyleVisitor,
  csharpSortingStyleVisitor,
  csharpDocstringCompletenessVisitor,
  csharpNamingConventionVisitor,
  csharpBuiltinTypeAliasVisitor,
  csharpEnumNameRedundantSuffixVisitor,
  csharpEnumNamingConventionVisitor,
  csharpFieldKeywordConflictVisitor,
  csharpFlagsEnumZeroNotNoneVisitor,
  csharpLoggerFieldNamingVisitor,
  csharpScopedIdentifierEscapeVisitor,
  csharpTypeNameSuffixConventionVisitor,
]
