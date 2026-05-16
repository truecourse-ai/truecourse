
// --- magic-string FP shape: framework-library-api (Kysely table alias reference) ---
declare const db: {
  selectFrom: (table: string) => {
    select: (cols: string[]) => {
      where: (col: string, op: string, val: unknown) => {
        execute: () => Promise<unknown[]>;
      };
    };
  };
};

async function getOrganisationTeams(orgId: string) {
  return db
    .selectFrom('Team as t')
    .select(['t.id', 't.name', 't.createdAt'])
    .where('t.organisationId', '=', orgId)
    .execute();
}



// --- magic-string FP shape: framework-library-api (OpenAPI/tRPC tags metadata) ---
declare function createRouter(opts: { tags?: string[]; meta?: Record<string, unknown> }): unknown;
declare function procedure(opts: { tags: string[]; summary: string }): unknown;

const documentFieldRouter = createRouter({
  tags: ['Document Fields'],
  meta: { openapi: true },
});

const createField = procedure({
  tags: ['Document Fields'],
  summary: 'Add a field to a document',
});



// --- magic-string FP shape: framework-library-api (TRPCError typed error code) ---
type TRPCErrorCode = 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'BAD_REQUEST' | 'INTERNAL_SERVER_ERROR';
declare class TRPCError extends Error { constructor(opts: { code: TRPCErrorCode; message?: string }); }

function requireAuthenticatedUser(userId: string | undefined): asserts userId is string {
  if (!userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  }
}



// --- magic-string FP shape: web-protocol-standard (Buffer encoding constants) ---
declare function readCertificateChain(path: string): Promise<string>;

async function loadCertificateChain(certPath: string): Promise<string> {
  const chainContents = await readCertificateChain(certPath);
  return Buffer.from(chainContents, 'base64').toString('utf-8');
}



// --- magic-string FP shape: web-protocol-standard (LLM message role constants) ---
type MessageRole = 'user' | 'assistant' | 'system';
type LLMMessage = { role: MessageRole; content: string };

declare function callLanguageModel(messages: LLMMessage[]): Promise<string>;

async function detectDocumentFields(documentText: string, instructions: string): Promise<string> {
  const messages: LLMMessage[] = [
    { role: 'system', content: instructions },
    { role: 'user', content: documentText },
  ];
  return callLanguageModel(messages);
}
