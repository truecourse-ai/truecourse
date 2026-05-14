// import { getServerLimits } from '@app/ee/server-only/limits/server';
// import { NEXT_PUBLIC_WEBAPP_URL } from '@app/lib/constants/app';
// import { DATE_FORMATS, DEFAULT_DOCUMENT_DATE_FORMAT } from '@app/lib/constants/date-formats';
// import { DocumentDataType, EnvelopeType, SigningStatus } from '@prisma/client';
// import { tsr } from '@ts-rest/serverless/fetch';
// import { match } from 'ts-pattern';
// import '@app/lib/constants/time-zones';
// import { DEFAULT_DOCUMENT_TIME_ZONE, TIME_ZONES } from '@app/lib/constants/time-zones';
// import { AppError } from '@app/lib/errors/app-error';
// import { deleteDocument } from '@app/lib/server-only/document/delete-document';
// import { findDocuments } from '@app/lib/server-only/document/find-documents';
// import { resendDocument } from '@app/lib/server-only/document/resend-document';
// import { sendDocument } from '@app/lib/server-only/document/send-document';
// import { createDocumentData } from '@app/lib/server-only/document-data/create-document-data';
// import { updateDocumentMeta } from '@app/lib/server-only/document-meta/upsert-document-meta';
// import { createEnvelope } from '@app/lib/server-only/envelope/create-envelope';
// import { getEnvelopeById, getEnvelopeWhereInput } from '@app/lib/server-only/envelope/get-envelope-by-id';
// import { deleteDocumentField } from '@app/lib/server-only/field/delete-document-field';
// import { updateEnvelopeFields } from '@app/lib/server-only/field/update-envelope-fields';
// import { insertFormValuesInPdf } from '@app/lib/server-only/pdf/insert-form-values-in-pdf';
// import { deleteEnvelopeRecipient } from '@app/lib/server-only/recipient/delete-envelope-recipient';
// import { getRecipientsForDocument } from '@app/lib/server-only/recipient/get-recipients-for-document';
// import { setDocumentRecipients } from '@app/lib/server-only/recipient/set-document-recipients';
// import { updateEnvelopeRecipients } from '@app/lib/server-only/recipient/update-envelope-recipients';
// import { createDocumentFromTemplate } from '@app/lib/server-only/template/create-document-from-template';
// import { deleteTemplate } from '@app/lib/server-only/template/delete-template';
// import { findTemplates } from '@app/lib/server-only/template/find-templates';
// import { getTemplateById } from '@app/lib/server-only/template/get-template-by-id';
// import { ZRecipientAuthOptionsSchema } from '@app/lib/types/document-auth';
// import { extractDerivedDocumentEmailSettings } from '@app/lib/types/document-email';
import {
// import { getFileServerSide } from '@app/lib/universal/upload/get-file.server';
// import { putNormalizedPdfFileServerSide } from '@app/lib/universal/upload/put-file.server';
// import { getPresignGetUrl, getPresignPostUrl } from '@app/lib/universal/upload/server-actions';
// import { isDocumentCompleted } from '@app/lib/utils/document';
// import { createDocumentAuditLogData } from '@app/lib/utils/document-audit-logs';
// import { mapSecondaryIdToDocumentId, mapSecondaryIdToTemplateId } from '@app/lib/utils/envelope';
// import { prisma } from '@app/prisma';
// import { ApiContractV1 } from './contract';
// import { authenticatedMiddleware } from './middleware/authenticated';

// ── snippet ──
// import { getEnvelopeById, getEnvelopeWhereInput } from '@app/lib/server-only/envelope/get-envelope-by-id';
// import { deleteDocumentField } from '@app/lib/server-only/field/delete-document-field';
// import { updateEnvelopeFields } from '@app/lib/server-only/field/update-envelope-fields';
// import { insertFormValuesInPdf } from '@app/lib/server-only/pdf/insert-form-values-in-pdf';
// import { deleteEnvelopeRecipient } from '@app/lib/server-only/recipient/delete-envelope-recipient';
// import { getRecipientsForDocument } from '@app/lib/server-only/recipient/get-recipients-for-document';
// import { setDocumentRecipients } from '@app/lib/server-only/recipient/set-document-recipients';
// import { updateEnvelopeRecipients } from '@app/lib/server-only/recipient/update-envelope-recipients';
// import { createDocumentFromTemplate } from '@app/lib/server-only/template/create-document-from-template';
// import { deleteTemplate } from '@app/lib/server-only/template/delete-template';
// import { findTemplates } from '@app/lib/server-only/template/find-templates';
// import { getTemplateById } from '@app/lib/server-only/template/get-template-by-id';
// import { ZRecipientAuthOptionsSchema } from '@app/lib/types/document-auth';
// import { extractDerivedDocumentEmailSettings } from '@app/lib/types/document-email';
import {
  ZCheckboxFieldMeta,
  ZDropdownFieldMeta,
  ZFieldMetaSchema,
  ZNumberFieldMeta,
  ZRadioFieldMeta,
  ZTextFieldMeta,
} from '@app/lib/types/field-meta';
// import { getFileServerSide } from '@app/lib/universal/upload/get-file.server';
// import { putNormalizedPdfFileServerSide } from '@app/lib/universal/upload/put-file.server';
// import { getPresignGetUrl, getPresignPostUrl } from '@app/lib/universal/upload/server-actions';
// import { isDocumentCompleted } from '@app/lib/utils/document';
// import { createDocumentAuditLogData } from '@app/lib/utils/document-audit-logs';
// import { mapSecondaryIdToDocumentId, mapSecondaryIdToTemplateId } from '@app/lib/utils/envelope';
// import { prisma } from '@app/prisma';

// import { ApiContractV1 } from './contract';
// import { authenticatedMiddleware } from './middleware/authenticated';

export const ApiContractV1Implementation = tsr.router(ApiContractV1, {
  getDocuments: authenticatedMiddleware(async (args, user, team) => {
    const page = Number(args.query.page) || 1;
    const perPage = Number(args.query.perPage) || 10;

    const { data: documents, totalPages } = await findDocuments({
      page,
      perPage,
      userId: user.id,
      teamId: team.id,
      folderId: args.query.folderId,
    });

    return {
      status: 200,
      body: {
        documents: documents.map((document) => ({
          id: mapSecondaryIdToDocumentId(document.secondaryId),
          externalId: document.externalId,
          userId: document.userId,
          teamId: document.teamId,
          folderId: document.folderId,
          title: document.title,
          status: document.status,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
          completedAt: document.completedAt,
        })),
        totalPages,
      },
    };
  }),

  getDocument: authenticatedMiddleware(async (args, user, team, { logger }) => {
    const { id: documentId } = args.params;

    logger.info({
      input: {
        id: documentId,
      },
    });

    try {
      const { envelopeWhereInput } = await getEnvelopeWhereInput({
        id: {
          type: 'documentId',
          id: Number(documentId),
        },
        type: EnvelopeType.DOCUMENT,
        userId: user.id,
        teamId: team.id,
      });

      const envelope = await prisma.envelope.findFirstOrThrow({
        where: envelopeWhereInput,
        include: {
          recipients: {
            orderBy: {
              id: 'asc',
            },
          },
          fields: {
            include: {
              signature: true,
              recipient: {
                select: {
                  name: true,