
// --- shape dc63fe3faa2e: Promise.all(docs.map(async docOpts => seedDoc(...))) ---
declare function seedDraftDocument(opts: { title: string; context: unknown }): Promise<{ id: string; title: string }>;
declare const testContext: unknown;

async function seedMultipleDraftDocuments(
  documents: Array<{ title: string }>,
): Promise<Array<{ id: string; title: string }>> {
  const results = await Promise.all(
    documents.map(async (docOptions) => seedDraftDocument({ ...docOptions, context: testContext })),
  );
  return results;
}



// --- expression-complexity shape: destructured-parameter-lists ---
// apiSeedPendingDocument accepts a large options object with defaults.
// This pattern is idiomatic for test seed helpers.
declare function apiCreateTestContext(name: string): Promise<{ token: string; userId: string }>;
declare function apiCreateEnvelope(
  token: string,
  opts: { title: string; recipients: unknown[] }
): Promise<{ id: string }>;
declare function apiDistributeEnvelope(
  token: string,
  envelopeId: string,
): Promise<{ recipients: Array<{ signingUrl: string }> }>;

export const apiSeedPendingDocument = async (
  token: string,
  options: {
    title?: string;
    recipients?: Array<{ email: string; name: string; role?: string }>;
    context?: { token: string; userId: string };
    expiresAt?: Date;
    fieldsPerRecipient?: Record<string, unknown[]>;
  } = {},
) => {
  const ctx = options.context ?? (await apiCreateTestContext('e2e-pending-doc'));

  const recipients = options.recipients ?? [
    {
      email: `signer-${Date.now()}@test.example.com`,
      name: 'Test Signer',
      role: 'SIGNER' as const,
    },
  ];

  const { id: envelopeId } = await apiCreateEnvelope(ctx.token, {
    title: options.title ?? '[TEST] API Document - Pending',
    recipients,
  });

  const distributeResult = await apiDistributeEnvelope(ctx.token, envelopeId);

  return { envelopeId, distributeResult, token: ctx.token };
};



// writeFileSync inside lazy-singleton factory called at most once — FP shape 0f23cc79e082
declare const fs: any;
declare const path: any;
declare function env(key: string): string | undefined;
declare function createSignerClient(opts: any): any;

let _signerInstance: any = null;

function createCloudSigner() {
  const credentialsPath = env('CLOUD_CREDENTIALS_PATH');
  const credentialsContents = env('CLOUD_CREDENTIALS_CONTENTS');

  if (credentialsPath && credentialsContents) {
    if (!fs.existsSync(credentialsPath)) {
      const contents = new Uint8Array(Buffer.from(credentialsContents, 'base64'));
      fs.writeFileSync(credentialsPath, contents);
    }
  }

  return createSignerClient({ keyPath: env('SIGNER_KEY_PATH') });
}

export function getSignerInstance() {
  if (!_signerInstance) {
    _signerInstance = createCloudSigner();
  }
  return _signerInstance;
}



// fs.existsSync in lazy-singleton init — executes at most once per process — FP shape 1edca18c9a7b
let _signerInstance2: any = null;

function initializeSignerWithCredentials() {
  const credPath = env('CREDENTIALS_FILE_PATH');
  const credContents = env('CREDENTIALS_FILE_CONTENTS');

  if (credPath && credContents) {
    if (!fs.existsSync(credPath)) {
      fs.writeFileSync(credPath, Buffer.from(credContents, 'base64'));
    }
  }

  return createSignerClient({ keyPath: env('HSM_KEY_PATH') });
}

export function getOrCreateSignerInstance() {
  if (!_signerInstance2) {
    _signerInstance2 = initializeSignerWithCredentials();
  }
  return _signerInstance2;
}



// fs.readFileSync in loadCertificates() — startup-time cert loading called from singleton factory — FP shape 29624c5980ed
async function loadSigningCertificates(): Promise<Uint8Array[]> {
  const chainContents = env('SIGNING_CERT_CHAIN_CONTENTS');
  const chainFilePath = env('SIGNING_CERT_CHAIN_FILE_PATH');

  if (chainContents) {
    return [Buffer.from(chainContents, 'base64')];
  }

  if (chainFilePath) {
    const certPem = fs.readFileSync(chainFilePath).toString('utf-8');
    return [Buffer.from(certPem)];
  }

  const certFilePath = env('SIGNING_CERT_FILE_PATH');
  if (certFilePath) {
    const certPem = fs.readFileSync(certFilePath).toString('utf-8');
    return [Buffer.from(certPem)];
  }

  return [];
}

let _cachedSigner: any = null;

export async function getOrCreateCachedSigner() {
  if (!_cachedSigner) {
    const certs = await loadSigningCertificates();
    _cachedSigner = createSignerClient({ certs });
  }
  return _cachedSigner;
}
