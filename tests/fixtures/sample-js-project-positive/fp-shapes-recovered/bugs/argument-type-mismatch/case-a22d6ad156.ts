// import { createEnvelopeFields } from '@documenso/lib/server-only/field/create-envelope-fields';
// import { deleteDocumentField } from '@documenso/lib/server-only/field/delete-document-field';
// import { deleteTemplateField } from '@documenso/lib/server-only/field/delete-template-field';
// import { getFieldById } from '@documenso/lib/server-only/field/get-field-by-id';
// import { removeSignedFieldWithToken } from '@documenso/lib/server-only/field/remove-signed-field-with-token';
// import { setFieldsForDocument } from '@documenso/lib/server-only/field/set-fields-for-document';
// import { setFieldsForTemplate } from '@documenso/lib/server-only/field/set-fields-for-template';
// import { signFieldWithToken } from '@documenso/lib/server-only/field/sign-field-with-token';
// import { updateEnvelopeFields } from '@documenso/lib/server-only/field/update-envelope-fields';
// import { EnvelopeType } from '@prisma/client';
// import { ZGenericSuccessResponse, ZSuccessResponseSchema } from '../schema';
// import { authenticatedProcedure, procedure, router } from '../trpc';
import {

// ── snippet ──
        },
      });

      const createdFields = await createEnvelopeFields({
        userId: ctx.user.id,
        teamId,
        id: {
          type: 'documentId',
          id: documentId,
        },
        fields: [
          {
            ...field,
            page: field.pageNumber,
            positionX: field.pageX,
            positionY: field.pageY,
          },
        ],
        requestMetadata: ctx.metadata,
      });

      return createdFields.fields[0];
    }),

  /**
   * @public
   */
  createDocumentFields: authenticatedProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/document/field/create-many',
        summary: 'Create document fields',
        description: 'Create multiple fields for a document.',
        tags: ['Document Fields'],
      },
    })
    .input(ZCreateDocumentFieldsRequestSchema)
    .output(ZCreateDocumentFieldsResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const { teamId } = ctx;
      const { documentId, fields } = input;

      ctx.logger.info({
        input: {
          documentId,
        },
      });

      return await createEnvelopeFields({
        userId: ctx.user.id,
        teamId,
        id: {
          type: 'documentId',
          id: documentId,
        },
        fields: fields.map((field) => ({
          ...field,
          page: field.pageNumber,
          positionX: field.pageX,
          positionY: field.pageY,
        })),
        requestMetadata: ctx.metadata,
      });
    }),

  /**
   * @public
   */
  updateDocumentField: authenticatedProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/document/field/update',
        summary: 'Update document field',
        description: 'Update a single field for a document.',
        tags: ['Document Fields'],
      },
    })
    .input(ZUpdateDocumentFieldRequestSchema)
    .output(ZUpdateDocumentFieldResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const { teamId } = ctx;
      const { documentId, field } = input;

      ctx.logger.info({
        input: {
          documentId,
        },
      });

      const updatedFields = await updateEnvelopeFields({
        userId: ctx.user.id,
        teamId,
        id: {
          type: 'documentId',
          id: documentId,
        },
        type: EnvelopeType.DOCUMENT,
        fields: [field],