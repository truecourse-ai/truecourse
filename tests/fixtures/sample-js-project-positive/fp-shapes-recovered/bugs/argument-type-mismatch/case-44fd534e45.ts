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
    const createdDirectRecipient = await tx.recipient.create({
      data: {
        envelopeId: createdEnvelope.id,
        email: directRecipientEmail,
        name: directRecipientName,
        authOptions: createRecipientAuthOptions({
          accessAuth: directTemplateRecipientAuthOptions.accessAuth,
          actionAuth: directTemplateRecipientAuthOptions.actionAuth,
        }),
        role: directTemplateRecipient.role,
        token: nanoid(),
        signingStatus: SigningStatus.SIGNED,
        sendStatus: SendStatus.SENT,
        signedAt: initialRequestTime,
        signingOrder: directTemplateRecipient.signingOrder,
        fields: {
          createMany: {
            data: directTemplateNonSignatureFields.map(({ templateField, customText }) => {
              let inserted = true;

              // Custom logic for V2 to only insert if values exist.
              if (directTemplateEnvelope.internalVersion === 2) {
                inserted = customText !== '';
              }

              return {
                envelopeId: createdEnvelope.id,
                envelopeItemId: oldEnvelopeItemToNewEnvelopeItemIdMap[templateField.envelopeItemId],
                type: templateField.type,
                page: templateField.page,
                positionX: templateField.positionX,
                positionY: templateField.positionY,
                width: templateField.width,
                height: templateField.height,
                customText: customText ?? '',
                inserted,
                fieldMeta: templateField.fieldMeta || Prisma.JsonNull,
              };
            }),
          },
        },
      },
      include: {
        fields: true,
      },
    });

    // Create any direct recipient signature fields.
    // Note: It's done like this because we can't nest things in createMany.
    const createdDirectRecipientSignatureFields: CreatedDirectRecipientField[] = await Promise.all(
      directTemplateSignatureFields.map(async ({ templateField, signature, derivedRecipientActionAuth }) => {
        if (!signature) {
          throw new Error('Not possible.');
        }

        const field = await tx.field.create({
          data: {
            envelopeId: createdEnvelope.id,
            envelopeItemId: oldEnvelopeItemToNewEnvelopeItemIdMap[templateField.envelopeItemId],
            recipientId: createdDirectRecipient.id,
            type: templateField.type,
            page: templateField.page,
            positionX: templateField.positionX,
            positionY: templateField.positionY,
            width: templateField.width,
            height: templateField.height,
            customText: '',
            inserted: true,
            fieldMeta: templateField.fieldMeta || Prisma.JsonNull,
            signature: {
              create: {
                recipientId: createdDirectRecipient.id,
                signatureImageAsBase64: signature.signatureImageAsBase64,
                typedSignature: signature.typedSignature,
              },
            },
          },
          include: {
            signature: true,
          },
        });

        return {
          field,
          derivedRecipientActionAuth,
        };
      }),
    );

    const createdDirectRecipientFields: CreatedDirectRecipientField[] = [
      ...createdDirectRecipient.fields.map((field) => ({
        field,
        derivedRecipientActionAuth: undefined,
      })),
      ...createdDirectRecipientSignatureFields,
    ];

    /**
     * Create the following audit logs.
     * - DOCUMENT_CREATED