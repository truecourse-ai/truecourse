
// Wave-M14: Promise.all(items.map(async (item) => {...})) — standard async map with Promise.all
declare const tokens: Array<{ value: string; userId: number }>;
declare function getUserByToken(opts: { token: string }): Promise<{ id: number; name: string }>;
declare function getDocByToken(opts: { token: string }): Promise<{ id: number; title: string }>;

async function resolveTokenBatch() {
  const resolved = await Promise.all(
    tokens.map(async (token) => {
      const user = await getUserByToken({ token: token.value });
      const doc = await getDocByToken({ token: token.value });
      return { user, doc };
    }),
  );
  return resolved;
}



// Wave-M22: Promise.allSettled(array.map(async (item) => ...)) — correct usage, no type mismatch
declare const expiredSessions: Array<{ id: string }>;
declare function triggerSessionCleanup(opts: { sessionId: string }): Promise<void>;
declare const jobs: { triggerJob: (opts: { name: string; payload: object }) => Promise<void> };

async function sweepExpiredSessions() {
  await Promise.allSettled(
    expiredSessions.map(async (session) => {
      await jobs.triggerJob({
        name: 'internal.cleanup-session',
        payload: { sessionId: session.id },
      });
    }),
  );
}



// Wave-M23: Promise.all(items.map(async ({fieldData, signatureData, authData}) => {...})) — destructured async map
declare const signatureFields: Array<{ fieldData: { id: string; type: string }; signatureData: { value: string } | null; authData: { level: string } }>;
declare function createSignedField(opts: { fieldId: string; type: string; value: string; authLevel: string }): Promise<{ id: string }>;

async function processSignatureFields() {
  const results = await Promise.all(
    signatureFields.map(async ({ fieldData, signatureData, authData }) => {
      if (!signatureData) {
        throw new Error('Missing signature data');
      }
      return createSignedField({
        fieldId: fieldData.id,
        type: fieldData.type,
        value: signatureData.value,
        authLevel: authData.level,
      });
    }),
  );
  return results;
}



// --- FP shape: outer sequential loop, inner Promise.all for intra-item parallelism ---
declare function generateSignatureCertificate(envelopeId: string): Promise<Uint8Array>;
declare function generateAuditLogPdf(envelopeId: string): Promise<Uint8Array>;
declare function finalizeEnvelopePdf(envelopeId: string, certPdf: Uint8Array, auditPdf: Uint8Array): Promise<void>;
declare const envelopeIds: string[];

async function sealAllEnvelopes(): Promise<void> {
  for (const envelopeId of envelopeIds) {
    const [certPdf, auditPdf] = await Promise.all([
      generateSignatureCertificate(envelopeId),
      generateAuditLogPdf(envelopeId),
    ]);
    await finalizeEnvelopePdf(envelopeId, certPdf, auditPdf);
  }
}



// --- FP shape: outer loop batches, inner Promise.allSettled parallelises each batch ---
declare function verifyEmailDomain(domain: string): Promise<{ domain: string; valid: boolean }>;
declare const DOMAIN_BATCH_SIZE = 50;
declare const allDomains: string[];

async function syncEmailDomainsInBatches(): Promise<void> {
  for (let offset = 0; offset < allDomains.length; offset += DOMAIN_BATCH_SIZE) {
    const batch = allDomains.slice(offset, offset + DOMAIN_BATCH_SIZE);
    await Promise.allSettled(batch.map((domain) => verifyEmailDomain(domain)));
  }
}



// --- FP shape: intentional await delay between batches to respect external API rate limits ---
declare const RATE_LIMIT_DELAY_MS = 1000;
declare const batches: Array<Array<{ id: string }>>;
declare function processBatch2(batch: Array<{ id: string }>): Promise<void>;

async function processBatchesWithRateLimit(): Promise<void> {
  for (const batch of batches) {
    await processBatch2(batch);
    // Respect SES API rate limit — intentional delay between batches
    await new Promise<void>((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
  }
}
