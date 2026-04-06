import type { CodeRuleVisitor } from '../../../types.js'

import { eventListenerNoRemoveVisitor } from './event-listener-no-remove.js'

export { eventListenerNoRemoveVisitor }

export const PERFORMANCE_JS_VISITORS: CodeRuleVisitor[] = [
  eventListenerNoRemoveVisitor,
]
