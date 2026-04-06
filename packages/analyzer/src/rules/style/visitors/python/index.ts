import type { CodeRuleVisitor } from '../../../types.js'

import { pythonCommentTagFormattingVisitor } from './comment-tag-formatting.js'

export { pythonCommentTagFormattingVisitor }

export const STYLE_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonCommentTagFormattingVisitor,
]
