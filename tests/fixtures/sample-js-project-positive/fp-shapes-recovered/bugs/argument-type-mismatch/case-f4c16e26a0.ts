// import { nanoid, prefixedId } from '@documenso/lib/universal/id';
// import { prisma } from '@documenso/prisma';
// import type { TSignFieldWithTokenMutationSchema } from '@documenso/trpc/server/field-router/schema';
// import type { Field, Signature } from '@prisma/client';
import {
// import { DateTime } from 'luxon';
// import { match } from 'ts-pattern';
// import { z } from 'zod';
// import { AppError, AppErrorCode } from '../../errors/app-error';
// import { jobs } from '../../jobs/client';
// import { DOCUMENT_AUDIT_LOG_TYPE, RECIPIENT_DIFF_TYPE } from '../../types/document-audit-logs';
// import type { TRecipientActionAuthTypes } from '../../types/document-auth';
// import { DocumentAccessAuth, ZRecipientAuthOptionsSchema } from '../../types/document-auth';
// import { extractDerivedDocumentEmailSettings } from '../../types/document-email';
// import { ZFieldMetaSchema } from '../../types/field-meta';
// import { mapEnvelopeToWebhookDocumentPayload, ZWebhookDocumentSchema } from '../../types/webhook-payload';
// import type { ApiRequestMetadata } from '../../universal/extract-request-metadata';
// import { getFileServerSide } from '../../universal/upload/get-file.server';
// import { putPdfFileServerSide } from '../../universal/upload/put-file.server';
// import { isRequiredField } from '../../utils/advanced-fields-helpers';
// import { extractDerivedDocumentMeta } from '../../utils/document';
// import type { CreateDocumentAuditLogDataResponse } from '../../utils/document-audit-logs';
// import { createDocumentAuditLogData } from '../../utils/document-audit-logs';
import {
// import { mapSecondaryIdToTemplateId } from '../../utils/envelope';
// import { sendDocument } from '../document/send-document';
// import { validateFieldAuth } from '../document/validate-field-auth';
// import { incrementDocumentId } from '../envelope/increment-id';
// import { getTeamSettings } from '../team/get-team-settings';
// import { triggerWebhook } from '../webhooks/trigger/trigger-webhook';

// ── snippet ──
      const { value, isBase64 } = signedFieldValue;

      const isSignatureField =
        templateField.type === FieldType.SIGNATURE || templateField.type === FieldType.FREE_SIGNATURE;

      let customText = !isSignatureField ? value : '';

      const signatureImageAsBase64 = isSignatureField && isBase64 ? value : undefined;
      const typedSignature = isSignatureField && !isBase64 ? value : undefined;

      if (templateField.type === FieldType.DATE) {
        customText = DateTime.now().setZone(derivedDocumentMeta.timezone).toFormat(derivedDocumentMeta.dateFormat);
      }

      if (isSignatureField && !signatureImageAsBase64 && !typedSignature) {
        throw new Error('Signature field must have a signature');
      }

      return {
        templateField,
        customText,
        derivedRecipientActionAuth,
        signature: isSignatureField
          ? {
              signatureImageAsBase64,
              typedSignature,
            }
          : null,
      };
    }),
  );

  const directTemplateNonSignatureFields = createDirectRecipientFieldArgs.filter(({ signature }) => signature === null);

  const directTemplateSignatureFields = createDirectRecipientFieldArgs.filter(({ signature }) => signature !== null);

  const initialRequestTime = new Date();

  // Key = original envelope item ID
  // Value = duplicated envelope item ID.
  const oldEnvelopeItemToNewEnvelopeItemIdMap: Record<string, string> = {};

  // Duplicate the envelope item data.
  const envelopeItemsToCreate = await Promise.all(
    directTemplateEnvelope.envelopeItems.map(async (item, i) => {
      const buffer = await getFileServerSide(item.documentData);

      const titleToUse = item.title || directTemplateEnvelope.title;

      const { documentData: newDocumentData } = await putPdfFileServerSide({
        name: titleToUse,
        type: 'application/pdf',
        arrayBuffer: async () => Promise.resolve(buffer),
      });

      const newEnvelopeItemId = prefixedId('envelope_item');

      oldEnvelopeItemToNewEnvelopeItemIdMap[item.id] = newEnvelopeItemId;

      return {
        id: newEnvelopeItemId,
        title: titleToUse.endsWith('.pdf') ? titleToUse.slice(0, -4) : titleToUse,
        documentDataId: newDocumentData.id,
        order: item.order !== undefined ? item.order : i + 1,
      };
    }),
  );

  const documentMeta = await prisma.documentMeta.create({
    data: derivedDocumentMeta,
  });

  const incrementedDocumentId = await incrementDocumentId();

  const { createdEnvelope, recipientId, token } = await prisma.$transaction(async (tx) => {
    // Create the envelope and non direct template recipients.
    const createdEnvelope = await tx.envelope.create({
      data: {
        id: prefixedId('envelope'),
        secondaryId: incrementedDocumentId.formattedDocumentId,
        type: EnvelopeType.DOCUMENT,
        internalVersion: directTemplateEnvelope.internalVersion,
        qrToken: prefixedId('qr'),
        source: DocumentSource.TEMPLATE_DIRECT_LINK,
        templateId: directTemplateEnvelopeLegacyId,
        userId: directTemplateEnvelope.userId,
        teamId: directTemplateEnvelope.teamId,
        title: directTemplateEnvelope.title,
        createdAt: initialRequestTime,
        status: DocumentStatus.PENDING,
        externalId: directTemplateExternalId,
        visibility: settings.documentVisibility,
        envelopeItems: {
          createMany: {
            data: envelopeItemsToCreate,
          },
        },
        authOptions: createDocumentAuthOptions({
          globalAccessAuth: templateAuthOptions.globalAccessAuth,
          globalActionAuth: templateAuthOptions.globalActionAuth,