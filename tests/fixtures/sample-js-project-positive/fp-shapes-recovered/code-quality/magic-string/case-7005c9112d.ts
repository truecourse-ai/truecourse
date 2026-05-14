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
// import { setFieldsForDocument } from '@documenso/lib/server-only/field/set-fields-for-document';
// import { setFieldsForTemplate } from '@documenso/lib/server-only/field/set-fields-for-template';
// import { signFieldWithToken } from '@documenso/lib/server-only/field/sign-field-with-token';
// import { updateEnvelopeFields } from '@documenso/lib/server-only/field/update-envelope-fields';
// import { EnvelopeType } from '@prisma/client';

// import { ZGenericSuccessResponse, ZSuccessResponseSchema } from '../schema';
// import { authenticatedProcedure, procedure, router } from '../trpc';
import {
  ZCreateDocumentFieldRequestSchema,
  ZCreateDocumentFieldResponseSchema,
  ZCreateDocumentFieldsRequestSchema,
  ZCreateDocumentFieldsResponseSchema,
  ZCreateTemplateFieldRequestSchema,
  ZCreateTemplateFieldResponseSchema,
  ZCreateTemplateFieldsRequestSchema,
  ZCreateTemplateFieldsResponseSchema,
  ZDeleteDocumentFieldRequestSchema,
  ZDeleteTemplateFieldRequestSchema,
  ZGetFieldRequestSchema,
  ZGetFieldResponseSchema,
  ZRemovedSignedFieldWithTokenMutationSchema,
  ZSetDocumentFieldsRequestSchema,
  ZSetDocumentFieldsResponseSchema,
  ZSetFieldsForTemplateRequestSchema,
  ZSetFieldsForTemplateResponseSchema,
  ZSignFieldWithTokenMutationSchema,
  ZUpdateDocumentFieldRequestSchema,
  ZUpdateDocumentFieldResponseSchema,
  ZUpdateDocumentFieldsRequestSchema,
  ZUpdateDocumentFieldsResponseSchema,
  ZUpdateTemplateFieldRequestSchema,
  ZUpdateTemplateFieldResponseSchema,
  ZUpdateTemplateFieldsRequestSchema,
  ZUpdateTemplateFieldsResponseSchema,
} from './schema';

export const fieldRouter = router({
  /**
   * @public
   */
  getDocumentField: authenticatedProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/document/field/{fieldId}',
        summary: 'Get document field',
        description:
          'Returns a single field. If you want to retrieve all the fields for a document, use the "Get Document" endpoint.',
        tags: ['Document Fields'],
      },
    })
    .input(ZGetFieldRequestSchema)
    .output(ZGetFieldResponseSchema)
    .query(async ({ input, ctx }) => {
      const { teamId } = ctx;
      const { fieldId } = input;

      ctx.logger.info({
        input: {
          fieldId,
        },
      });

      return await getFieldById({
        userId: ctx.user.id,
        teamId,
        fieldId,
        envelopeType: EnvelopeType.DOCUMENT,
      });
    }),

  /**
   * @public
   */
  createDocumentField: authenticatedProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/document/field/create',
        summary: 'Create document field',
        description: 'Create a single field for a document.',
        tags: ['Document Fields'],
      },
    })
    .input(ZCreateDocumentFieldRequestSchema)
    .output(ZCreateDocumentFieldResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const { teamId } = ctx;
      const { documentId, field } = input;

      ctx.logger.info({
        input: {
          documentId,
        },
      });

      const createdFields = await createEnvelopeFields({
        userId: ctx.user.id,
        teamId,