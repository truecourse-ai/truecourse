import {
// import type { WebhookPayload } from '../../../types/webhook-payload';

// ── snippet ──
  RecipientRole,
  SendStatus,
  SigningStatus,
  WebhookTriggerEvents,
} from '@prisma/client';

// import type { WebhookPayload } from '../../../types/webhook-payload';

export const generateSampleWebhookPayload = (event: WebhookTriggerEvents, webhookUrl: string): WebhookPayload => {
  const now = new Date();
  const basePayload = {
    id: 10,
    externalId: null,
    userId: 1,
    authOptions: null,
    formValues: null,
    visibility: DocumentVisibility.EVERYONE,
    title: 'documenso.pdf',
    status: DocumentStatus.DRAFT,
    documentDataId: 'hs8qz1ktr9204jn7mg6c5dxy0',
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    deletedAt: null,
    teamId: null,
    templateId: null,
    source: DocumentSource.DOCUMENT,
    documentMeta: {
      id: 'doc_meta_123',
      subject: 'Please sign this document',
      message: 'Hello, please review and sign this document.',
      timezone: 'UTC',
      password: null,
      dateFormat: 'MM/DD/YYYY',
      redirectUrl: null,
      signingOrder: DocumentSigningOrder.PARALLEL,
      allowDictateNextSigner: false,
      typedSignatureEnabled: true,
      uploadSignatureEnabled: true,
      drawSignatureEnabled: true,
      language: 'en',
      distributionMethod: DocumentDistributionMethod.EMAIL,
      emailSettings: null,
    },
    recipients: [
      {
        id: 52,
        documentId: 10,
        templateId: null,
        email: 'signer@documenso.com',
        name: 'John Doe',
        token: 'SIGNING_TOKEN',
        documentDeletedAt: null,
        expiresAt: null,
        expirationNotifiedAt: null,
        signedAt: null,
        authOptions: null,
        signingOrder: 1,
        rejectionReason: null,
        role: RecipientRole.SIGNER,
        readStatus: ReadStatus.NOT_OPENED,
        signingStatus: SigningStatus.NOT_SIGNED,
        sendStatus: SendStatus.NOT_SENT,
      },
    ],
    Recipient: [
      {
        id: 52,
        documentId: 10,
        templateId: null,
        email: 'signer@documenso.com',
        name: 'John Doe',
        token: 'SIGNING_TOKEN',
        documentDeletedAt: null,
        expiresAt: null,
        expirationNotifiedAt: null,
        signedAt: null,
        authOptions: null,
        signingOrder: 1,
        rejectionReason: null,
        role: RecipientRole.SIGNER,
        readStatus: ReadStatus.NOT_OPENED,
        signingStatus: SigningStatus.NOT_SIGNED,
        sendStatus: SendStatus.NOT_SENT,
      },
    ],
  };

  if (event === WebhookTriggerEvents.DOCUMENT_CREATED) {
    return {
      event,
      payload: {
        ...basePayload,
        status: DocumentStatus.DRAFT,
      },
      createdAt: now.toISOString(),
      webhookEndpoint: webhookUrl,
    };
  }
