import type { CodeRuleVisitor } from '../../../types.js'

import { commentTagFormattingVisitor } from './comment-tag-formatting.js'

export { commentTagFormattingVisitor }

export const STYLE_JS_VISITORS: CodeRuleVisitor[] = [
  commentTagFormattingVisitor,
]
