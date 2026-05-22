// `primitives/` is listed in the `@sample/ui-kit` package's `files` field,
// so `@sample/ui-kit/primitives/badge` is the package's published public
// sub-path API — not internal reach-through. Flagging this import as
// cross-service-internal-import is a false positive.

import type { BadgeTone } from '@sample/ui-kit/primitives/badge';
import { renderBadge } from '@sample/ui-kit/primitives/badge';

export function describeBadge(label: string, tone: BadgeTone): string {
  return renderBadge(label, tone);
}
