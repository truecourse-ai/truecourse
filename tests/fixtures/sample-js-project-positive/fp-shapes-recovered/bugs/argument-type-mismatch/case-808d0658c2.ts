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
  const finalRecipients: FinalRecipient[] = template.recipients.map((templateRecipient) => {
    const foundRecipient = recipients.find((recipient) => recipient.id === templateRecipient.id);

    return {
      templateRecipientId: templateRecipient.id,
      fields: templateRecipient.fields,
      name: foundRecipient ? (foundRecipient.name ?? '') : templateRecipient.name,
      email: foundRecipient ? foundRecipient.email : templateRecipient.email,
      role: templateRecipient.role,
      signingOrder: foundRecipient?.signingOrder ?? templateRecipient.signingOrder,
      authOptions: templateRecipient.authOptions,
      token: nanoid(),
    };
  });

  const defaultRecipients = settings.defaultRecipients
    ? ZDefaultRecipientsSchema.parse(settings.defaultRecipients)
    : [];

  const defaultRecipientsFinal: FinalRecipient[] = defaultRecipients.map((recipient) => {
    const authOptions = ZRecipientAuthOptionsSchema.parse({});

    return {
      templateRecipientId: -1,
      fields: [],
      name: recipient.name || recipient.email,
      email: recipient.email,
      role: recipient.role,
      signingOrder: null,
      authOptions: createRecipientAuthOptions({
        accessAuth: authOptions.accessAuth,
        actionAuth: authOptions.actionAuth,
      }),
      token: nanoid(),
    };
  });

  const allFinalRecipients = [...finalRecipients, ...defaultRecipientsFinal];

  // Key = original envelope item ID
  // Value = duplicated envelope item ID.
  const oldEnvelopeItemToNewEnvelopeItemIdMap: Record<string, string> = {};

  // Duplicate the envelope item data.
  // Note: This is duplicated in createDocumentFromDirectTemplate
  const envelopeItemsToCreate = await Promise.all(
    template.envelopeItems.map(async (item, i) => {
      let documentDataIdToDuplicate = item.documentDataId;

      const foundCustomDocumentData = customDocumentData.find((customDocumentDataItem) => {
        // Handle empty envelopeItemId for backwards compatibility reasons.
        if (customDocumentDataItem.documentDataId && !customDocumentDataItem.envelopeItemId) {
          return true;
        }

        return customDocumentDataItem.envelopeItemId === item.id;
      });

      if (foundCustomDocumentData) {
        documentDataIdToDuplicate = foundCustomDocumentData.documentDataId;
      }

      const documentDataToDuplicate = await prisma.documentData.findFirst({
        where: {
          id: documentDataIdToDuplicate,
        },
      });

      if (!documentDataToDuplicate) {
        throw new AppError(AppErrorCode.NOT_FOUND, {
          message: 'Document data not found',
        });
      }

      let buffer = await getFileServerSide(documentDataToDuplicate);

      const titleToUse = item.title || finalEnvelopeTitle;

      if (formValues) {
        // eslint-disable-next-line require-atomic-updates
        buffer = await insertFormValuesInPdf({
          pdf: Buffer.from(buffer),
          formValues,
        });
      }

      const duplicatedFile = await putNormalizedPdfFileServerSide({
        name: titleToUse,
        type: 'application/pdf',
        arrayBuffer: async () => Promise.resolve(buffer),
      });

      const newDocumentData = await prisma.documentData.create({
        data: {
          type: duplicatedFile.type,
          data: duplicatedFile.data,
          initialData: documentDataToDuplicate.data,
        },
      });
