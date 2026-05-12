/**
 * if/else-if chains without a final else that are intentional and correct.
 *
 * Each block below covers a real-world shape where the missing else clause
 * is the documented intent: exhaustive prior guards, bounded-enum dispatch,
 * accumulators that add only on match, iteration silent-skip, and chains
 * that follow a pre-initialized default.
 */

declare const totpCode: string | undefined;
declare const backupCode: string | undefined;
declare function validateTotp(code: string): boolean;
declare function validateBackup(code: string): boolean;

// Mode: exhaustive-conditions-implicit-noop
// Earlier guard throws when neither code is present, so the if/else-if
// already covers every reachable state - a trailing else would be dead code.
export function verifyTwoFactor(): boolean {
  if (totpCode === undefined && backupCode === undefined) {
    throw new Error('Either totpCode or backupCode required');
  }
  let isValid = false;
  if (totpCode) {
    isValid = validateTotp(totpCode);
  } else if (backupCode) {
    isValid = validateBackup(backupCode);
  }
  return isValid;
}

declare function deleteDocument(id: string): Promise<void>;
declare function deleteTemplate(id: string): Promise<void>;

interface BulkItem {
  readonly id: string;
  readonly type: 'DOCUMENT' | 'TEMPLATE' | 'ARCHIVED';
}

// Mode: type-category-dispatch-unknown-skip
// Bulk delete dispatches by discriminant; ARCHIVED items are intentionally
// skipped (handled by a different code path) so no else branch is needed.
export async function bulkDelete(items: readonly BulkItem[]): Promise<void> {
  for (const item of items) {
    if (item.type === 'DOCUMENT') {
      await deleteDocument(item.id);
    } else if (item.type === 'TEMPLATE') {
      await deleteTemplate(item.id);
    }
  }
}

interface SnapTarget {
  readonly left: number;
  readonly right: number;
}

interface SnapGuide {
  readonly axis: 'x';
  readonly value: number;
}

const SNAP_THRESHOLD = 4;

// Mode: accumulator-add-on-match-only
// Guide lines are accumulated only when an edge is within the snap
// threshold; when neither edge is close enough, adding nothing is correct.
export function collectSnapGuides(
  pointer: number,
  targets: readonly SnapTarget[],
): SnapGuide[] {
  const guides: SnapGuide[] = [];
  for (const target of targets) {
    if (Math.abs(pointer - target.left) <= SNAP_THRESHOLD) {
      guides.push({ axis: 'x', value: target.left });
    } else if (Math.abs(pointer - target.right) <= SNAP_THRESHOLD) {
      guides.push({ axis: 'x', value: target.right });
    }
  }
  return guides;
}

type RefLike<T> = ((value: T | null) => void) | { current: T | null } | null | undefined;

// Mode: iteration-silent-skip
// mergeRefs-style iteration: callable refs are invoked, object refs are
// assigned, null/undefined refs are silently skipped on purpose.
export function mergeRefs<T>(refs: ReadonlyArray<RefLike<T>>): (value: T | null) => void {
  return (value: T | null): void => {
    for (const ref of refs) {
      if (typeof ref === 'function') {
        ref(value);
      } else if (ref) {
        ref.current = value;
      }
    }
  };
}

interface FieldGeometry {
  readonly fieldX: number;
  readonly fieldWidth: number;
  readonly textWidth: number;
  readonly padding: number;
  readonly align: 'left' | 'center' | 'right';
}

// Mode: pre-initialized-default-variable
// textX is initialized to the left-aligned position; the chain only
// overrides for center and right. No else is required because the
// default has already been applied above the if.
export function computeTextX(geom: FieldGeometry): number {
  let textX = geom.fieldX + geom.padding;
  if (geom.align === 'center') {
    textX = geom.fieldX + (geom.fieldWidth - geom.textWidth) / 2;
  } else if (geom.align === 'right') {
    textX = geom.fieldX + geom.fieldWidth - geom.textWidth - geom.padding;
  }
  return textX;
}
