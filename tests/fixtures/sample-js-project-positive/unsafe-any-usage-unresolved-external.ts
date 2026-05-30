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
import type { Envelope } from 'unresolved-orm-lib';
import { Controller } from 'unresolved-form-lib';
import { CanvasGroup } from 'unresolved-canvas-lib';
import { useCurrentTeam } from 'unresolved-context-lib';

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

// 5) Destructured prop typed by an unresolved import. `envelope` is `any` only
// because `Envelope` (an ORM model type) can't be resolved without
// node_modules — the member access must NOT fire.
export function EnvelopeRow({ envelope }: { envelope: Envelope }): string {
  return envelope.id;
}

// 6) react-hook-form-style render callback. The destructured `field` parameter
// is `any` because the form library's generic is unresolved — accessing
// `field.value` / calling `field.onChange` must NOT fire.
export function FieldControl(): unknown {
  return Controller({
    name: 'subject',
    render: ({ field }) => {
      field.onChange('next');
      return field.value;
    },
  });
}

// 7) `new` of an unresolved class. `group` is `any` because `CanvasGroup`'s
// type can't resolve — calling `.add()` must NOT fire.
export function buildGroup(): unknown {
  const group = new CanvasGroup({ x: 0, y: 0 });
  group.add({ kind: 'rect' });
  return group;
}

// 8) Local const-arrow helper whose return type is inferred-any (its body
// returns an unresolved-typed value). `const team = useCurrentTeam()` is any,
// so `team.id` must NOT fire.
const resolveTeam = () => useCurrentTeam();

export function readTeamId(): string {
  const team = resolveTeam();
  return team.id;
}

// 9) Variable with a type annotation referencing an unresolved import. `record`
// is `any` only because `Envelope` can't resolve — `record.id` must NOT fire.
export function readScope(load: () => unknown): string {
  const record: Envelope = load() as Envelope;
  return record.id;
}
