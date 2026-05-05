/**
 * `void someAsync()` is the canonical "fire-and-forget Promise" pattern
 * recommended by @typescript-eslint/no-floating-promises. Both
 * `bugs/deterministic/void-zero-argument` and `code-quality/deterministic/no-void`
 * must skip this shape — they're meant for the `void 0` quirk and
 * confusing `void <expr>` usage, NOT for marking unawaited Promises.
 *
 * Mirrors documenso's
 *   apps/docs/src/components/mdx/mermaid.tsx:55     `void render();`
 *   apps/remix/app/components/dialogs/...:onClick={() => void onAction()}
 */

import { useEffect } from 'react';

declare function refreshLimits(): Promise<void>;
declare function deleteEnvelope(args: { envelopeId: string }): Promise<void>;
declare function onCopy(label: string, value: string): Promise<void>;

export function VoidFireAndForget({ id }: { readonly id: string }): JSX.Element {
  useEffect(() => {
    void refreshLimits();
  }, [id]);

  return (
    <div>
      <button type="button" onClick={() => void deleteEnvelope({ envelopeId: id })}>
        Delete
      </button>
      <button type="button" onClick={() => void onCopy('Local', id)}>
        Copy
      </button>
    </div>
  );
}
