// import { useLimits } from '@app/ee/server-only/limits/provider/client';
// import { useEnvelopeAutosave } from '@app/lib/client-only/hooks/use-envelope-autosave';
// import { useCurrentEnvelopeEditor } from '@app/lib/client-only/providers/envelope-editor-provider';
// import { useCurrentOrganisation } from '@app/lib/client-only/providers/organisation';
// import { APP_DOCUMENT_UPLOAD_SIZE_LIMIT } from '@app/lib/constants/app';
// import type { TEditorEnvelope } from '@app/lib/types/envelope-editor';
// import { nanoid } from '@app/lib/universal/id';
// import { megabytesToBytes } from '@app/lib/universal/unit-convertions';
// import { PRESIGNED_ENVELOPE_ITEM_ID_PREFIX } from '@app/lib/utils/embed-config';
// import { getEnvelopeItemPermissions } from '@app/lib/utils/envelope';
// import { trpc } from '@app/trpc/react';
// import type { TCreateEnvelopeItemsPayload } from '@app/trpc/server/envelope-router/create-envelope-items.types';
// import type { TReplaceEnvelopeItemPdfPayload } from '@app/trpc/server/envelope-router/replace-envelope-item-pdf.types';
// import { buildDropzoneRejectionDescription } from '@app/ui/lib/handle-dropzone-rejection';
// import { Button } from '@app/ui/primitives/button';
// import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@app/ui/primitives/card';
// import { DocumentDropzone } from '@app/ui/primitives/document-dropzone';
// import { useToast } from '@app/ui/primitives/use-toast';
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
      formData.append('file', file);

      const replacePromise = replaceEnvelopeItemPdf(formData);
      registerPendingMutation(replacePromise);

      await replacePromise;
    } catch (error) {
      console.error(error);

      toast({
        title: t`Replace failed`,
        description: t`Something went wrong while replacing the PDF`,
        duration: 5000,
        variant: 'destructive',
      });
    } finally {
      setLocalFiles((prev) =>
        prev.map((f) => (f.envelopeItemId === envelopeItemId ? { ...f, isReplacing: false } : f)),
      );
    }
  };

  /**
   * Hide the envelope item from the list on deletion.
   */
  const onFileDelete = (envelopeItemId: string) => {
    setLocalFiles((prev) => prev.filter((uploadingFile) => uploadingFile.envelopeItemId !== envelopeItemId));

    const fieldsWithoutDeletedItem = envelope.fields.filter((field) => field.envelopeItemId !== envelopeItemId);

    setLocalEnvelope({
      envelopeItems: envelope.envelopeItems.filter((item) => item.id !== envelopeItemId),
      fields: envelope.fields.filter((field) => field.envelopeItemId !== envelopeItemId),