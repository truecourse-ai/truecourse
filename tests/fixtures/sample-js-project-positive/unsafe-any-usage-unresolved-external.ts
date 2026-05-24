// When the analyzed target hasn't installed its node_modules (the routine
// case), every import from a third-party library resolves to `any` from the
// analyzer's POV. The developer's code is well-typed against the real lib
// (Zod schemas, query hooks, generated DB clients, typed factory helpers),
// so flagging "unsafe any usage" on these chains is pure noise.
//
// All shapes below were the FP samples on the routine target. The rule must
// NOT fire on any of them.

import { z } from 'unresolved-schema-lib';
import { useTypedQuery } from 'unresolved-query-lib';
import { useState } from 'unresolved-ui-lib';
import { prismaLike } from 'unresolved-orm-lib';

// 1) Schema parse — `.parse()` would give back the inferred output type.
const SearchParamsSchema = z.object({ q: z.string() });
type SearchParams = ReturnType<typeof SearchParamsSchema.parse>;

export function readSearchParams(input: unknown): SearchParams {
  const parsedSearchParams = SearchParamsSchema.parse(input);
  return { q: parsedSearchParams.q };
}

// 2) Library-provided query hook — `data` is fully typed against the route
// schema, but the lib's `useTypedQuery` resolves to any here.
export function readEmailMeta(documentId: string): string {
  const emailData = useTypedQuery(['documents', documentId, 'emailMeta']);
  return emailData.subject;
}

// 3) Hook with an explicit generic — the analyzer's TS service still sees
// the call as any because the hook itself is any.
export function ToggleControl(): boolean {
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  setPendingValue('initial');
  return pendingValue !== null && pendingValue.length > 0;
}

// 4) Destructure from a generated ORM client — the row type would carry full
// column types in the real project.
export async function getRecipientEmail(recipientId: string): Promise<string | null> {
  const recipient = await prismaLike.recipient.findUnique({ where: { id: recipientId } });
  if (!recipient) return null;
  return recipient.email;
}
