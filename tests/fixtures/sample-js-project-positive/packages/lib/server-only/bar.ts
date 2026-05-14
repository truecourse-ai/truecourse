
// FP shape: distinct buffer encoding steps in a single transport function (single-usage-false-trigger)
declare function parsePem(input: string): Array<{ der: Buffer }>;
declare function getEnvVar(key: string): string | undefined;

function loadSigningCertChain(): Buffer[] {
  const chainContents = getEnvVar('SIGNING_CERT_CHAIN_CONTENTS');
  const chainFilePath = getEnvVar('SIGNING_CERT_CHAIN_FILE_PATH');

  if (chainContents) {
    return parsePem(Buffer.from(chainContents, 'base64').toString('utf-8')).map((block) => block.der);
  }

  if (chainFilePath) {
    const fs = require('fs');
    return parsePem(fs.readFileSync(chainFilePath).toString('utf-8')).map((block) => block.der);
  }

  return [];
}



// FP shape: AI message role string literal in a single function's messages array (single-usage-false-trigger)
declare function generateStructuredOutput(options: {
  messages: Array<{ role: string; content: string }>;
  schema: unknown;
}): Promise<unknown>;

async function detectFieldsWithAi(imageData: string, context: string) {
  const messages: Array<{ role: string; content: string }> = [
    {
      role: 'user',
      content: buildDetectionPrompt(imageData, context),
    },
  ];

  return generateStructuredOutput({ messages, schema: FieldDetectionSchema });
}

declare function buildDetectionPrompt(image: string, ctx: string): string;
declare const FieldDetectionSchema: unknown;



// FP shape: dynamic import string literal for a single lazy-loaded module (single-usage-false-trigger)
declare function getStorageClient(): unknown;

async function generatePresignedUploadUrl(fileName: string, contentType: string): Promise<string> {
  const client = getStorageClient();
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

  const command = buildPutObjectCommand(fileName, contentType);
  return getSignedUrl(client as never, command as never, { expiresIn: 3600 });
}

declare function buildPutObjectCommand(name: string, type: string): unknown;



// FP shape: font family string repeated across within-file text style configs (within-file-structural-repetition)
declare const Renderer: {
  Text: new (opts: { text: string; fontFamily: string; fontSize: number; fill: string }) => { getNode(): unknown };
};

function buildAuditLogPage(entries: string[]): unknown[] {
  const nodes: unknown[] = [];

  for (const entry of entries) {
    const label = new Renderer.Text({
      text: entry,
      fontFamily: 'Inter',
      fontSize: 14,
      fill: '#111827',
    });

    const timestamp = new Renderer.Text({
      text: new Date().toISOString(),
      fontFamily: 'Inter',
      fontSize: 12,
      fill: '#6B7280',
    });

    nodes.push(label.getNode(), timestamp.getNode());
  }

  return nodes;
}



// FP shape: hardcoded test email literal in a single sample-data generator (single-usage-false-trigger)
interface WebhookPayload {
  id: number;
  documentId: number;
  recipients: Array<{ id: number; email: string; name: string; token: string }>;
}

function generateWebhookSamplePayload(): WebhookPayload {
  return {
    id: 1,
    documentId: 42,
    recipients: [
      {
        id: 52,
        email: 'signer@example-corp.com',
        name: 'Jane Smith',
        token: 'SAMPLE_SIGNING_TOKEN',
      },
    ],
  };
}



// FP shape: external package name string in a single vite/build config (single-usage-false-trigger)
declare function defineConfig(options: {
  ssr?: {
    external?: string[];
    noExternal?: string[];
  };
}): unknown;

const buildConfig = defineConfig({
  ssr: {
    noExternal: ['react-dropzone'],
    external: [
      '@napi-rs/canvas',
      '@node-rs/bcrypt',
      'playwright',
      'playwright-core',
    ],
  },
});



// FP shape: discriminant type string in a single identifier lookup call (single-usage-false-trigger)
declare function getEnvelopeWhereInput(opts: {
  id: { type: string; id: number | string };
  type: string;
  userId: string;
  teamId: string;
}): Promise<{ envelopeWhereInput: unknown }>;

async function getDocumentById(documentId: string, userId: string, teamId: string) {
  const { envelopeWhereInput } = await getEnvelopeWhereInput({
    id: {
      type: 'documentId',
      id: Number(documentId),
    },
    type: 'DOCUMENT',
    userId,
    teamId,
  });

  return envelopeWhereInput;
}



// FP shape: discriminant type string in two independent router procedures (parallel-independent-call-sites)
declare function getEnvelopeWhereInput(opts: {
  id: { type: string; id: string | number };
  type: string | null;
  userId: string;
  teamId: string;
}): Promise<{ envelopeWhereInput: unknown }>;

async function updateEnvelopeSettings(envelopeId: string, userId: string, teamId: string) {
  const { envelopeWhereInput } = await getEnvelopeWhereInput({
    id: { type: 'envelopeId', id: envelopeId },
    type: null,
    userId,
    teamId,
  });

  return envelopeWhereInput;
}

async function deleteEnvelopeHandler(envelopeId: string, userId: string, teamId: string) {
  const { envelopeWhereInput } = await getEnvelopeWhereInput({
    id: { type: 'envelopeId', id: envelopeId },
    type: 'DOCUMENT',
    userId,
    teamId,
  });

  return envelopeWhereInput;
}



// console.error(label, error) then re-throw — error only used as function argument — FP shape 01fbadc79507
declare function findFoldersFromDb(opts: any): Promise<any[]>;

async function findFoldersInternal(opts: { userId: string; teamId: string }) {
  try {
    const folders = await findFoldersFromDb(opts);

    return await Promise.all(
      folders.map(async (folder: any) => {
        try {
          return { ...folder, itemCount: 0 };
        } catch (error) {
          console.error('Error processing folder:', folder.id, error);
          throw error;
        }
      }),
    );
  } catch (error) {
    console.error('Error in findFolders:', error);
    throw error;
  }
}



// logger.error({ error }) passes error as shorthand property — no MemberExpression on catch param — FP shape 0e8fd0b7061d
declare const logger: { error: (obj: Record<string, unknown>) => void };
declare function checkRateLimit(opts: any): Promise<{ count: number }>;

async function checkRequestRateLimit(config: any, identifier: string) {
  try {
    const result = await checkRateLimit({ action: config.action, identifier });

    return {
      isLimited: result.count > config.max,
      remaining: Math.max(0, config.max - result.count),
      limit: config.max,
    };
  } catch (error) {
    // Fail-open: if the rate limit check fails, allow the request through.
    logger.error({
      msg: 'Rate limit check failed, failing open',
      action: config.action,
      error,
    });

    return { isLimited: false, remaining: config.max, limit: config.max };
  }
}
