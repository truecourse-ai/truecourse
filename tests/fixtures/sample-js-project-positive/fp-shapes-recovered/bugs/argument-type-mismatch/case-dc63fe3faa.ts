// import fs from 'node:fs';
// import path from 'node:path';
// import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
// import { createApiToken } from '@documenso/lib/server-only/public-api/create-api-token';
// import { mapSecondaryIdToTemplateId } from '@documenso/lib/utils/envelope';
// import { seedUser } from '@documenso/prisma/seed/users';
import type {
import type {
// import type { TCreateEnvelopeRecipientsResponse } from '@documenso/trpc/server/envelope-router/envelope-recipients/create-envelope-recipients.types';
// import type { TGetEnvelopeResponse } from '@documenso/trpc/server/envelope-router/get-envelope.types';
// import { type APIRequestContext, expect } from '@playwright/test';

// ── snippet ──
  if (!directRecipient) {
    throw new Error(`Direct template recipient not found: ${directRecipientEmail}`);
  }

  const numericTemplateId = mapSecondaryIdToTemplateId(templateResult.envelope.secondaryId);

  const directLink = await apiCreateDirectTemplateLink(
    request,
    templateResult.token,
    numericTemplateId,
    directRecipient.id,
  );

  // Re-fetch envelope to include directLink data
  const envelope = await apiGetEnvelope(request, templateResult.token, templateResult.envelope.id);

  return {
    ...templateResult,
    envelope,
    directLink,
  };
};

/**
 * Seed multiple draft documents in parallel for a single user context.
 *
 * Useful for tests that need multiple documents (e.g., bulk actions, find/filter tests).
 *
 * @example
 * ```ts
 * const { documents, token, user, team } = await apiSeedMultipleDraftDocuments(request, [
 *   { title: 'Doc A' },
 *   { title: 'Doc B' },
 *   { title: 'Doc C' },
 * ]);
 * ```
 */
export const apiSeedMultipleDraftDocuments = async (
  request: APIRequestContext,
  documents: ApiSeedDocumentOptions[],
  context?: ApiSeedContext,
): Promise<{
  documents: TGetEnvelopeResponse[];
  token: string;
  user: ApiSeedContext['user'];
  team: ApiSeedContext['team'];
}> => {
  const ctx = context ?? (await apiCreateTestContext('e2e-multi-doc'));

  const results = await Promise.all(
    documents.map(async (docOptions) => apiSeedDraftDocument(request, { ...docOptions, context: ctx })),
  );

  return {
    documents: results.map((r) => r.envelope),
    token: ctx.token,
    user: ctx.user,
    team: ctx.team,
  };
};
