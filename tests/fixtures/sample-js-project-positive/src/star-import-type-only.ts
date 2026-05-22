/**
 * Positive fixture for code-quality/deterministic/star-import.
 *
 * `import type * as X from 'pkg'` is a type-only namespace import. The
 * `type` keyword causes the entire import to be erased at compile time,
 * so there is no runtime module load and no tree-shaking implication.
 * The rule should not fire on type-only namespace imports.
 */

import type * as PrismaShapes from '@prisma/client';

export type FieldRow = PrismaShapes.Field;

export function describePage(field: FieldRow): string {
  return `${field.id}:page-${field.page}`;
}
