// import { useLimits } from '@documenso/ee/server-only/limits/provider/client';
// import { useEnvelopeAutosave } from '@documenso/lib/client-only/hooks/use-envelope-autosave';
// import { useCurrentEnvelopeEditor } from '@documenso/lib/client-only/providers/envelope-editor-provider';
// import { useCurrentOrganisation } from '@documenso/lib/client-only/providers/organisation';
// import { APP_DOCUMENT_UPLOAD_SIZE_LIMIT } from '@documenso/lib/constants/app';
// import type { TEditorEnvelope } from '@documenso/lib/types/envelope-editor';
// import { nanoid } from '@documenso/lib/universal/id';
// import { megabytesToBytes } from '@documenso/lib/universal/unit-convertions';
// import { PRESIGNED_ENVELOPE_ITEM_ID_PREFIX } from '@documenso/lib/utils/embed-config';
// import { getEnvelopeItemPermissions } from '@documenso/lib/utils/envelope';
// import { trpc } from '@documenso/trpc/react';
// import type { TCreateEnvelopeItemsPayload } from '@documenso/trpc/server/envelope-router/create-envelope-items.types';
// import type { TReplaceEnvelopeItemPdfPayload } from '@documenso/trpc/server/envelope-router/replace-envelope-item-pdf.types';
// import { buildDropzoneRejectionDescription } from '@documenso/ui/lib/handle-dropzone-rejection';
// import { Button } from '@documenso/ui/primitives/button';
// import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@documenso/ui/primitives/card';
// import { DocumentDropzone } from '@documenso/ui/primitives/document-dropzone';
// import { useToast } from '@documenso/ui/primitives/use-toast';
// import type { DropResult } from '@hello-pangea/dnd';
// import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
// import { msg, plural } from '@lingui/core/macro';
// import { Trans, useLingui } from '@lingui/react/macro';
// import { FileWarningIcon, GripVerticalIcon, Loader2Icon, PencilIcon, XIcon } from 'lucide-react';
// import { useEffect, useMemo, useRef, useState } from 'react';
// import { ErrorCode as DropzoneErrorCode, type FileRejection, useDropzone } from 'react-dropzone';
// import { EnvelopeItemDeleteDialog } from '~/components/dialogs/envelope-item-delete-dialog';
// import { EnvelopeEditorRecipientForm } from './envelope-editor-recipient-form';
// import { EnvelopeItemTitleInput } from './envelope-editor-title-input';

// ── snippet ──
            id: file.envelopeItemId!,
            title: file.title,
            order: envelope.envelopeItems.length + 1,
            envelopeId: envelope.id,
            data: file.data!,
            documentDataId: '',
          })),
        ],
      });

      return;
    }

    const payload = {
      envelopeId: envelope.id,
    } satisfies TCreateEnvelopeItemsPayload;

    const formData = new FormData();

    formData.append('payload', JSON.stringify(payload));

    for (const file of files) {
      formData.append('files', file);
    }

    const createPromise = createEnvelopeItems(formData);

    registerPendingMutation(createPromise);

    const { data } = await createPromise.catch((error) => {
      console.error(error);

      // Set error state on files in batch upload.
      setLocalFiles((prev) =>
        prev.map((uploadingFile) =>
          uploadingFile.id === newUploadingFiles.find((file) => file.id === uploadingFile.id)?.id
            ? { ...uploadingFile, isError: true, isUploading: false }
            : uploadingFile,
        ),
      );

      throw error;
    });

    setLocalFiles((prev) => {
      const filteredFiles = prev.filter(
        (uploadingFile) => uploadingFile.id !== newUploadingFiles.find((file) => file.id === uploadingFile.id)?.id,
      );

      return filteredFiles.concat(
        data.map((item) => ({
          id: item.id,
          envelopeItemId: item.id,
          title: item.title,
          isUploading: false,
          isReplacing: false,
          isError: false,
        })),
      );
    });
  };

  const onReplacePdf = async (envelopeItemId: string, file: File) => {
    setLocalFiles((prev) => prev.map((f) => (f.envelopeItemId === envelopeItemId ? { ...f, isReplacing: true } : f)));

    try {
      if (isEmbedded) {
        // For embedded mode, store the file data locally on the envelope item.
        // The actual replacement will happen when the embed flow submits.
        const arrayBuffer = await file.arrayBuffer();
        const data = new Uint8Array(arrayBuffer.slice(0));

        // Count pages in the new PDF to remove out-of-bounds fields.
        const { PDF } = await import('@libpdf/core');
        const pdfDoc = await PDF.load(data);
        const newPageCount = pdfDoc.getPageCount();

        // Remove fields that are on pages beyond the new PDF's page count.
        const remainingFields = envelope.fields.filter(
          (field) => field.envelopeItemId !== envelopeItemId || field.page <= newPageCount,
        );

        setLocalEnvelope({
          envelopeItems: envelope.envelopeItems.map((item) => (item.id === envelopeItemId ? { ...item, data } : item)),
          fields: remainingFields,
        });

        editorFields.resetForm(remainingFields);

        return;
      }

      // Normal mode: upload immediately via tRPC.
      const payload = {
        envelopeId: envelope.id,
        envelopeItemId,
      } satisfies TReplaceEnvelopeItemPdfPayload;

      const formData = new FormData();
      formData.append('payload', JSON.stringify(payload));