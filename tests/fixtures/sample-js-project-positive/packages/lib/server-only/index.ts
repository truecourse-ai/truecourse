
// --- argument-type-mismatch shape: function call receiving discriminated union id object ---
type ResourceId =
  | { type: 'orderId'; id: number }
  | { type: 'invoiceId'; id: number };

declare function getResourceById(opts: { id: ResourceId; userId: number; teamId?: number }): Promise<{ id: number; status: string } | null>;

async function checkResourceAccess(orderId: number, userId: number, teamId: number | null): Promise<boolean> {
  return getResourceById({
    id: { type: 'orderId', id: orderId },
    userId,
    teamId: teamId ?? undefined,
  })
    .then((resource) => !!resource)
    .catch(() => false);
}



// --- argument-type-mismatch shape: Promise.all with two parallel typed function calls ---
declare function getWorkspaceById(opts: { workspaceId: number; userId: number }): Promise<{ id: number; name: string }>;
declare function getUserPermissions(opts: { workspaceId: number; reference: { type: string; id: number } }): Promise<{ role: string }>;

async function getWorkspaceContext(userId: number, workspaceId: number) {
  const [workspace, { role }] = await Promise.all([
    getWorkspaceById({ workspaceId, userId }),
    getUserPermissions({
      workspaceId,
      reference: { type: 'User', id: userId },
    }),
  ]);

  return { workspace, role };
}



// --- argument-type-mismatch shape: prisma.$transaction with async callback creating records ---
declare const prisma: {
  $transaction: <T>(fn: (tx: typeof prisma) => Promise<T>) => Promise<T>;
  credential: { create: (opts: { data: object }) => Promise<{ id: string }> };
  auditLog: { create: (opts: { data: object }) => Promise<void> };
};

async function registerCredential(
  userId: string,
  credentialData: { publicKey: Buffer; counter: number; deviceType: string },
  meta?: { ipAddress?: string; userAgent?: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.credential.create({
      data: {
        userId,
        publicKey: credentialData.publicKey,
        counter: credentialData.counter,
        deviceType: credentialData.deviceType,
      },
    });

    await tx.auditLog.create({
      data: {
        userId,
        event: 'CREDENTIAL_CREATED',
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      },
    });
  });
}



// --- argument-type-mismatch shape: pMap with Array.from ignoring element using index parameter ---
declare function pMap<T, R>(input: T[], mapper: (element: T, index: number) => Promise<R>, opts?: object): Promise<R[]>;
declare function renderPage(pageNumber: number, scale: number): Promise<Buffer>;

async function renderAllPages(pageCount: number, scale: number = 2): Promise<Buffer[]> {
  return pMap(
    Array.from({ length: pageCount }),
    async (_, index) => {
      const pageNumber = index + 1;
      return renderPage(pageNumber, scale);
    },
    { concurrency: 4 },
  );
}



// --- argument-type-mismatch shape: Promise.all with async map inside prisma.$transaction ---
declare const prisma3: {
  $transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
};

interface FieldInput { id?: string; type: string; label: string; recipientId: string; required: boolean }

async function persistFormFields(formId: string, fields: FieldInput[]): Promise<void> {
  await prisma3.$transaction(async (tx) => {
    return await Promise.all(
      fields.map(async (field) => {
        await tx.formField.upsert({
          where: { id: field.id ?? '' },
          create: { formId, type: field.type, label: field.label, recipientId: field.recipientId, required: field.required },
          update: { type: field.type, label: field.label, required: field.required },
        });
      }),
    );
  });
}
