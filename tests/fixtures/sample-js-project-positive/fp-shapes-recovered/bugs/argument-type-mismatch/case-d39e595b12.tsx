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
    isEmbedded,
    navigateToStep,
    registerExternalFlush,
    registerPendingMutation,
  } = useCurrentEnvelopeEditor();

  const { envelopeItems: uploadConfig } = editorConfig;

  const [localFiles, setLocalFiles] = useState<LocalFile[]>(
    envelope.envelopeItems
      .sort((a, b) => a.order - b.order)
      .map((item) => ({
        id: item.id,
        title: item.title,
        envelopeItemId: item.id,
        isUploading: false,
        isReplacing: false,
        isError: false,
      })),
  );

  const replacingItemIdRef = useRef<string | null>(null);

  const { open: openReplaceFilePicker, getInputProps: getReplaceInputProps } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    maxSize: megabytesToBytes(APP_DOCUMENT_UPLOAD_SIZE_LIMIT),
    multiple: false,
    noClick: true,
    noKeyboard: true,
    noDrag: true,
    onDrop: (acceptedFiles) => {
      const file = acceptedFiles[0];
      const replacingItemId = replacingItemIdRef.current;

      if (file && replacingItemId) {
        void onReplacePdf(replacingItemId, file);
        replacingItemIdRef.current = null;
      }
    },
    onDropRejected: (fileRejections) => void onFileDropRejected(fileRejections),
    onFileDialogCancel: () => {
      replacingItemIdRef.current = null;
    },
  });

  const { mutateAsync: createEnvelopeItems, isPending: isCreatingEnvelopeItems } =
    trpc.envelope.item.createMany.useMutation({
      onSuccess: ({ data }) => {
        const createdEnvelopes = data.filter(
          (item) => !envelope.envelopeItems.find((envelopeItem) => envelopeItem.id === item.id),
        );

        setLocalEnvelope({
          envelopeItems: [...envelope.envelopeItems, ...createdEnvelopes],
        });
      },
    });

  const { mutateAsync: updateEnvelopeItems } = trpc.envelope.item.updateMany.useMutation({
    onSuccess: ({ data }) => {
      setLocalEnvelope({
        envelopeItems: envelope.envelopeItems.map((originalItem) => {
          const updatedItem = data.find((item) => item.id === originalItem.id);

          if (updatedItem) {
            return {
              ...originalItem,
              ...updatedItem,
            };
          }

          return originalItem;
        }),
      });
    },
  });

  const envelopeItemPermissions = useMemo(
    () => getEnvelopeItemPermissions(envelope, envelope.recipients),
    [envelope, envelope.recipients],
  );

  const { mutateAsync: replaceEnvelopeItemPdf } = trpc.envelope.item.replacePdf.useMutation({
    onSuccess: ({ data, fields }) => {
      // Update the envelope item with the new documentDataId.
      setLocalEnvelope({
        envelopeItems: envelope.envelopeItems.map((item) =>
          item.id === data.id ? { ...item, documentDataId: data.documentDataId } : item,
        ),
      });

      // When fields were created or deleted during the replacement,
      // the server returns the full updated field list.
      if (fields) {
        setLocalEnvelope({ fields });
        editorFields.resetForm(fields);
      }
    },
  });