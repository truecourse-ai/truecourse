import type { CodeRuleVisitor } from '../../../types.js'

export { importFormattingVisitor } from './import-formatting.js'
export { commentTagFormattingVisitor } from './comment-tag-formatting.js'
export { jsStylePreferenceVisitor } from './js-style-preference.js'
export { tsDeclarationStyleVisitor } from './ts-declaration-style.js'
export { sortingStyleVisitor } from './sorting-style.js'
export { jsNamingConventionVisitor } from './js-naming-convention.js'
export { whitespaceFormattingVisitor } from './whitespace-formatting.js'

import { importFormattingVisitor } from './import-formatting.js'
import { commentTagFormattingVisitor } from './comment-tag-formatting.js'
import { jsStylePreferenceVisitor } from './js-style-preference.js'
import { tsDeclarationStyleVisitor } from './ts-declaration-style.js'
import { sortingStyleVisitor } from './sorting-style.js'
import { jsNamingConventionVisitor } from './js-naming-convention.js'
import { whitespaceFormattingVisitor } from './whitespace-formatting.js'

export const STYLE_JS_VISITORS: CodeRuleVisitor[] = [
  importFormattingVisitor,
  commentTagFormattingVisitor,
  jsStylePreferenceVisitor,
  tsDeclarationStyleVisitor,
  sortingStyleVisitor,
  jsNamingConventionVisitor,
  whitespaceFormattingVisitor,
]
