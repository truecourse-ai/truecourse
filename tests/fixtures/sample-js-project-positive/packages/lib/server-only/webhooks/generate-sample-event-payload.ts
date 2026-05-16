// Simulated enums mirroring Prisma client values
const RecipientRole = { SIGNER: 'SIGNER', CC: 'CC', VIEWER: 'VIEWER', APPROVER: 'APPROVER' } as const;
const ReadStatus = { OPENED: 'OPENED', NOT_OPENED: 'NOT_OPENED' } as const;
const SendStatus = { SENT: 'SENT', NOT_SENT: 'NOT_SENT' } as const;
const SigningStatus = { SIGNED: 'SIGNED', NOT_SIGNED: 'NOT_SIGNED', REJECTED: 'REJECTED' } as const;
const DocumentStatus = { DRAFT: 'DRAFT', PENDING: 'PENDING', COMPLETED: 'COMPLETED', DECLINED: 'DECLINED' } as const;
const DocumentSource = { DOCUMENT: 'DOCUMENT', TEMPLATE: 'TEMPLATE', API: 'API' } as const;
const WebhookTriggerEvent = { DOCUMENT_CREATED: 'DOCUMENT_CREATED', DOCUMENT_SENT: 'DOCUMENT_SENT', DOCUMENT_OPENED: 'DOCUMENT_OPENED', DOCUMENT_SIGNED: 'DOCUMENT_SIGNED', DOCUMENT_COMPLETED: 'DOCUMENT_COMPLETED' } as const;

type WebhookTriggerEventType = keyof typeof WebhookTriggerEvent;

export const generateSampleWebhookPayload = (
  event: WebhookTriggerEventType,
  webhookUrl: string,
) => {
  const now = new Date();

  const baseDocument = {
    id: 42,
    externalId: null,
    userId: 1,
    title: 'sample-contract.pdf',
    status: DocumentStatus.PENDING,
    documentDataId: 'sample_data_id_abc123',
    source: DocumentSource.DOCUMENT,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    deletedAt: null,
    teamId: null,
    templateId: null,
    documentMeta: {
      id: 'meta_sample_001',
      subject: 'Please sign this agreement',
      message: 'Kindly review and sign the attached document.',
      timezone: 'UTC',
      password: null,
      dateFormat: 'YYYY-MM-DD',
      redirectUrl: null,
      language: 'en',
    },
    recipients: [
      {
        id: 100,
        documentId: 42,
        name: 'Alice Johnson',
        email: 'alice@example.com',
        token: 'sample_token_alice',
        role: RecipientRole.SIGNER,
        readStatus: ReadStatus.OPENED,
        sendStatus: SendStatus.SENT,
        signingStatus: SigningStatus.NOT_SIGNED,
        signedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };

  const eventPayload = {
    event,
    createdAt: now.toISOString(),
    webhookEndpoint: webhookUrl,
    data: baseDocument,
  };

  return eventPayload;
};
