// import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
// import type { PlaceholderInfo } from '@documenso/lib/server-only/pdf/auto-place-fields';
// import { convertPlaceholdersToFieldInputs } from '@documenso/lib/server-only/pdf/auto-place-fields';
// import { findRecipientByPlaceholder } from '@documenso/lib/server-only/pdf/helpers';
// import { normalizePdf as makeNormalizedPdf } from '@documenso/lib/server-only/pdf/normalize-pdf';
// import { ZDefaultRecipientsSchema } from '@documenso/lib/types/default-recipients';
// import { DOCUMENT_AUDIT_LOG_TYPE } from '@documenso/lib/types/document-audit-logs';
// import type { ApiRequestMetadata } from '@documenso/lib/universal/extract-request-metadata';
// import { nanoid, prefixedId } from '@documenso/lib/universal/id';
// import { createDocumentAuditLogData } from '@documenso/lib/utils/document-audit-logs';
// import { prisma } from '@documenso/prisma';
// import type { DocumentMeta, DocumentVisibility, TemplateType } from '@prisma/client';
import {
import type {
// import type { TDocumentFormValues } from '../../types/document-form-values';
// import type { TEnvelopeAttachmentType } from '../../types/envelope-attachment';
// import type { TFieldAndMeta } from '../../types/field-meta';
// import { mapEnvelopeToWebhookDocumentPayload, ZWebhookDocumentSchema } from '../../types/webhook-payload';
// import { getFileServerSide } from '../../universal/upload/get-file.server';
// import { putPdfFileServerSide } from '../../universal/upload/put-file.server';
// import { extractDerivedDocumentMeta } from '../../utils/document';
// import { createDocumentAuthOptions, createRecipientAuthOptions } from '../../utils/document-auth';
// import { buildTeamWhereQuery } from '../../utils/teams';
// import { incrementDocumentId, incrementTemplateId } from '../envelope/increment-id';
// import { getTeamSettings } from '../team/get-team-settings';
// import { triggerWebhook } from '../webhooks/trigger/trigger-webhook';

// ── snippet ──
        message: 'Folder not found',
      });
    }
  }

  const settings = await getTeamSettings({
    userId,
    teamId,
  });

  if (data.envelopeItems.length !== 1 && internalVersion === 1) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: 'Envelope items must have exactly 1 item for version 1',
    });
  }

  let envelopeItems = data.envelopeItems;

  // Todo: Envelopes - Remove
  if (normalizePdf) {
    envelopeItems = await Promise.all(
      data.envelopeItems.map(async (item) => {
        const documentData = await prisma.documentData.findFirst({
          where: {
            id: item.documentDataId,
          },
        });

        if (!documentData) {
          throw new AppError(AppErrorCode.NOT_FOUND, {
            message: 'Document data not found',
          });
        }

        const buffer = await getFileServerSide(documentData);

        const normalizedPdf = await makeNormalizedPdf(Buffer.from(buffer), {
          flattenForm: type !== EnvelopeType.TEMPLATE,
        });

        const titleToUse = item.title || title;

        const { documentData: newDocumentData } = await putPdfFileServerSide({
          name: titleToUse,
          type: 'application/pdf',
          arrayBuffer: async () => Promise.resolve(normalizedPdf),
        });

        return {
          title: titleToUse.endsWith('.pdf') ? titleToUse.slice(0, -4) : titleToUse,
          documentDataId: newDocumentData.id,
          order: item.order,
        };
      }),
    );
  }

  const authOptions = createDocumentAuthOptions({
    globalAccessAuth: globalAccessAuth || [],
    globalActionAuth: globalActionAuth || [],
  });

  const recipientsHaveActionAuth = data.recipients?.some(
    (recipient) => recipient.actionAuth && recipient.actionAuth.length > 0,
  );

  // Check if user has permission to set the global action auth.
  if (
    (authOptions.globalActionAuth.length > 0 || recipientsHaveActionAuth) &&
    !team.organisation.organisationClaim.flags.cfr21
  ) {
    throw new AppError(AppErrorCode.UNAUTHORIZED, {
      message: 'You do not have permission to set the action auth',
    });
  }

  const visibility = visibilityOverride || settings.documentVisibility;

  const emailId = meta?.emailId;

  // Validate that the email ID belongs to the organisation.
  if (emailId) {
    const email = await prisma.organisationEmail.findFirst({
      where: {
        id: emailId,
        organisationId: team.organisationId,
      },
    });

    if (!email) {
      throw new AppError(AppErrorCode.NOT_FOUND, {
        message: 'Email not found',
      });
    }
  }

  // userTimezone is last because it's always passed in regardless of the organisation/team settings
  // for uploads from the frontend
  const timezoneToUse = meta?.timezone || settings.documentTimezone || userTimezone;
