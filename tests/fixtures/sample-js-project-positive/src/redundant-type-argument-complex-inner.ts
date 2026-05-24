/**
 * `Array<...>` (and friends) with a non-`any` inner type — even if
 * TypeScript's compiler can't fully resolve the inner type and falls
 * back to `any` internally — should NOT trigger
 * `code-quality/deterministic/redundant-type-argument`. The user wrote
 * a concrete inner type and removing it would erase intent.
 */

interface SignatureMeta {
  name: string;
}

interface RecipientRow {
  id: string;
  meta: SignatureMeta | null;
}

export const recipients: Array<
  RecipientRow & {
    extra: { tag: string };
  }
> = [];

export const tags: Array<RecipientRow & { tag: string }> = [];
