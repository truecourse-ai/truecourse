// import { getServerLimits } from '@documenso/ee/server-only/limits/server';
// import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
// import { jobs } from '@documenso/lib/jobs/client';
// import { getDocumentWithDetailsById } from '@documenso/lib/server-only/document/get-document-with-details-by-id';
// import { sendDocument } from '@documenso/lib/server-only/document/send-document';
// import { createDocumentData } from '@documenso/lib/server-only/document-data/create-document-data';
// import { createEnvelope } from '@documenso/lib/server-only/envelope/create-envelope';
// import { duplicateEnvelope } from '@documenso/lib/server-only/envelope/duplicate-envelope';
// import { updateEnvelope } from '@documenso/lib/server-only/envelope/update-envelope';
import {
// import { createDocumentFromTemplate } from '@documenso/lib/server-only/template/create-document-from-template';
// import { createTemplateDirectLink } from '@documenso/lib/server-only/template/create-template-direct-link';
// import { deleteTemplate } from '@documenso/lib/server-only/template/delete-template';
// import { deleteTemplateDirectLink } from '@documenso/lib/server-only/template/delete-template-direct-link';
// import { findOrganisationTemplates } from '@documenso/lib/server-only/template/find-organisation-templates';
// import { findTemplates } from '@documenso/lib/server-only/template/find-templates';
// import { getOrganisationTemplateById } from '@documenso/lib/server-only/template/get-organisation-template-by-id';
// import { getTemplateById } from '@documenso/lib/server-only/template/get-template-by-id';
// import { toggleTemplateDirectLink } from '@documenso/lib/server-only/template/toggle-template-direct-link';
// import { putNormalizedPdfFileServerSide } from '@documenso/lib/universal/upload/put-file.server';
// import { getPresignPostUrl } from '@documenso/lib/universal/upload/server-actions';
// import { mapSecondaryIdToTemplateId } from '@documenso/lib/utils/envelope';
// import { mapFieldToLegacyField } from '@documenso/lib/utils/fields';
// import { mapRecipientToLegacyRecipient } from '@documenso/lib/utils/recipients';
// import { mapEnvelopeToTemplateLite } from '@documenso/lib/utils/templates';
// import type { Envelope } from '@prisma/client';
// import { DocumentDataType, EnvelopeType } from '@prisma/client';
// import { ZGenericSuccessResponse, ZSuccessResponseSchema } from '../schema';
// import { authenticatedProcedure, maybeAuthenticatedProcedure, router } from '../trpc';
// import { getTemplatesByIdsRoute } from './get-templates-by-ids';
import {

// ── snippet ──
        },
        teamId,
        userId: ctx.user.id,
        recipients,
        customDocumentData,
        requestMetadata: ctx.metadata,
        folderId,
        prefillFields,
        externalId,
        override,
        attachments,
        formValues,
      });

      if (distributeDocument) {
        await sendDocument({
          id: {
            type: 'envelopeId',
            id: envelope.id,
          },
          userId: ctx.user.id,
          teamId,
          requestMetadata: ctx.metadata,
        }).catch((err) => {
          console.error(err);

          if (err instanceof AppError) {
            throw err;
          }

          throw new AppError('DOCUMENT_SEND_FAILED');
        });
      }

      return getDocumentWithDetailsById({
        id: {
          type: 'envelopeId',
          id: envelope.id,
        },
        userId: ctx.user.id,
        teamId,
      });
    }),

  /**
   * Leaving this endpoint as private for now until there is a use case for it.
   *
   * @private
   */
  createDocumentFromDirectTemplate: maybeAuthenticatedProcedure
    // .meta({
    //   openapi: {
    //     method: 'POST',
    //     path: '/template/direct/use',
    //     summary: 'Use direct template',
    //     description: 'Use a direct template to create a document',
    //     tags: ['Template'],
    //   },
    // })
    .input(ZCreateDocumentFromDirectTemplateRequestSchema)
    .output(ZCreateDocumentFromDirectTemplateResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const {
        directRecipientName,
        directRecipientEmail,
        directTemplateToken,
        directTemplateExternalId,
        signedFieldValues,
        templateUpdatedAt,
        nextSigner,
      } = input;

      ctx.logger.info({
        input: {
          directTemplateToken,
        },
      });

      return await createDocumentFromDirectTemplate({
        directRecipientName,
        directRecipientEmail,
        directTemplateToken,
        directTemplateExternalId,
        signedFieldValues,
        templateUpdatedAt,
        user: ctx.user
          ? {
              id: ctx.user.id,
              name: ctx.user.name || undefined,
              email: ctx.user.email,
            }
          : undefined,
        nextSigner,
        requestMetadata: ctx.metadata,
      });
    }),

  /**
   * @public
   */