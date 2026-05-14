// import { nanoid, prefixedId } from '@documenso/lib/universal/id';
// import { prisma } from '@documenso/prisma';
// import type { DocumentDistributionMethod, DocumentSigningOrder } from '@prisma/client';
import {
// import { DateTime } from 'luxon';
// import { match } from 'ts-pattern';
// import { DEFAULT_DOCUMENT_DATE_FORMAT } from '../../constants/date-formats';
// import type { TEnvelopeExpirationPeriod } from '../../constants/envelope-expiration';
// import type { SupportedLanguageCodes } from '../../constants/i18n';
// import { AppError, AppErrorCode } from '../../errors/app-error';
// import { ZDefaultRecipientsSchema } from '../../types/default-recipients';
// import { DOCUMENT_AUDIT_LOG_TYPE } from '../../types/document-audit-logs';
// import { ZRecipientAuthOptionsSchema } from '../../types/document-auth';
// import type { TDocumentEmailSettings } from '../../types/document-email';
// import type { TDocumentFormValues } from '../../types/document-form-values';
import type {
// import { ZCheckboxFieldMeta, ZDropdownFieldMeta, ZFieldMetaSchema, ZRadioFieldMeta } from '../../types/field-meta';
// import { mapEnvelopeToWebhookDocumentPayload, ZWebhookDocumentSchema } from '../../types/webhook-payload';
// import type { ApiRequestMetadata } from '../../universal/extract-request-metadata';
// import { getFileServerSide } from '../../universal/upload/get-file.server';
// import { putNormalizedPdfFileServerSide } from '../../universal/upload/put-file.server';
// import { extractDerivedDocumentMeta } from '../../utils/document';
// import { createDocumentAuditLogData } from '../../utils/document-audit-logs';
import {
// import type { EnvelopeIdOptions } from '../../utils/envelope';
// import { mapSecondaryIdToTemplateId } from '../../utils/envelope';
// import { buildTeamWhereQuery } from '../../utils/teams';
// import { getEnvelopeWhereInput } from '../envelope/get-envelope-by-id';
// import { incrementDocumentId } from '../envelope/increment-id';
// import { insertFormValuesInPdf } from '../pdf/insert-form-values-in-pdf';
// import { getTeamSettings } from '../team/get-team-settings';
// import { triggerWebhook } from '../webhooks/trigger/trigger-webhook';
// import { getOrganisationTemplateWhereInput } from './get-organisation-template-by-id';

// ── snippet ──
      }),
    });

    const templateAttachments = await tx.envelopeAttachment.findMany({
      where: {
        envelopeId: template.id,
      },
    });

    const attachmentsToCreate = [
      ...templateAttachments.map((attachment) => ({
        envelopeId: envelope.id,
        type: attachment.type,
        label: attachment.label,
        data: attachment.data,
      })),
      ...(attachments || []).map((attachment) => ({
        envelopeId: envelope.id,
        type: attachment.type || 'link',
        label: attachment.label,
        data: attachment.data,
      })),
    ];

    if (attachmentsToCreate.length > 0) {
      await tx.envelopeAttachment.createMany({
        data: attachmentsToCreate,
      });
    }

    const createdEnvelope = await tx.envelope.findFirst({
      where: {
        id: envelope.id,
      },
      include: {
        documentMeta: true,
        recipients: true,
      },
    });

    if (!createdEnvelope) {
      throw new Error('Document not found');
    }

    return { envelope, createdEnvelope };
  });

  // Trigger webhook outside the transaction to avoid holding the connection
  // open during network I/O.
  await Promise.allSettled([
    triggerWebhook({
      event: WebhookTriggerEvents.DOCUMENT_CREATED,
      data: ZWebhookDocumentSchema.parse(mapEnvelopeToWebhookDocumentPayload(createdEnvelope)),
      userId,
      teamId,
    }),
    triggerWebhook({
      event: WebhookTriggerEvents.TEMPLATE_USED,
      data: ZWebhookDocumentSchema.parse(mapEnvelopeToWebhookDocumentPayload(createdEnvelope)),
      userId,
      teamId,
    }),
  ]);

  return envelope;
};
