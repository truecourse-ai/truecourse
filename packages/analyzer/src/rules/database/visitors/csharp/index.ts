import type { CodeRuleVisitor } from '../../../types.js'

export { csharpSelectStarVisitor } from './select-star.js'
export { csharpUnsafeDeleteWithoutWhereVisitor } from './unsafe-delete-without-where.js'
export { csharpMissingMigrationVisitor } from './missing-migration.js'
export { csharpConnectionNotReleasedVisitor } from './connection-not-released.js'
export { csharpMissingTransactionVisitor } from './missing-transaction.js'
export { csharpOrmLazyLoadInLoopVisitor } from './orm-lazy-load-in-loop.js'
export { csharpUnvalidatedExternalDataVisitor } from './unvalidated-external-data.js'

import { csharpSelectStarVisitor } from './select-star.js'
import { csharpUnsafeDeleteWithoutWhereVisitor } from './unsafe-delete-without-where.js'
import { csharpMissingMigrationVisitor } from './missing-migration.js'
import { csharpConnectionNotReleasedVisitor } from './connection-not-released.js'
import { csharpMissingTransactionVisitor } from './missing-transaction.js'
import { csharpOrmLazyLoadInLoopVisitor } from './orm-lazy-load-in-loop.js'
import { csharpUnvalidatedExternalDataVisitor } from './unvalidated-external-data.js'

export const DATABASE_CSHARP_VISITORS: CodeRuleVisitor[] = [
  csharpSelectStarVisitor,
  csharpUnsafeDeleteWithoutWhereVisitor,
  csharpMissingMigrationVisitor,
  csharpConnectionNotReleasedVisitor,
  csharpMissingTransactionVisitor,
  csharpOrmLazyLoadInLoopVisitor,
  csharpUnvalidatedExternalDataVisitor,
]
