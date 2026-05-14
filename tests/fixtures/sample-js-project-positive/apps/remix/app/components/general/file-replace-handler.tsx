
// FP: React component with async upload state management — standard React framework structure
declare const useIsEmbedded: () => boolean;
declare const uploadEnvelopeFile: (file: File) => Promise<{ id: string; title: string }>;
declare const replaceEnvelopeItem: (itemId: string, file: File) => Promise<{ id: string; title: string }>;
declare const useToast: () => { toast: (opts: { title: string; variant?: string }) => void };

type LocalFile = {
  id: string;
  envelopeItemId?: string;
  title: string;
  isUploading: boolean;
  isReplacing: boolean;
  isError: boolean;
};

type FileReplaceHandlerProps = {
  localFiles: LocalFile[];
  setLocalFiles: React.Dispatch<React.SetStateAction<LocalFile[]>>;
  envelopeId: string;
};

export function useFileReplaceHandler({ localFiles, setLocalFiles, envelopeId }: FileReplaceHandlerProps) {
  const isEmbedded = useIsEmbedded();
  const { toast } = useToast();

  const onReplacePdf = async (envelopeItemId: string, file: File) => {
    setLocalFiles((prev) =>
      prev.map((f) => (f.envelopeItemId === envelopeItemId ? { ...f, isReplacing: true } : f)),
    );

    try {
      if (isEmbedded) {
        // For embedded mode, store the file data locally on the envelope item.
        const reader = new FileReader();
        await new Promise<void>((resolve, reject) => {
          reader.onload = () => resolve();
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        setLocalFiles((prev) =>
          prev.map((f) =>
            f.envelopeItemId === envelopeItemId
              ? { ...f, isReplacing: false, title: file.name }
              : f,
          ),
        );
      } else {
        const result = await replaceEnvelopeItem(envelopeItemId, file);

        setLocalFiles((prev) =>
          prev.map((f) =>
            f.envelopeItemId === envelopeItemId
              ? { ...f, isReplacing: false, title: result.title, id: result.id }
              : f,
          ),
        );
      }
    } catch {
      toast({ title: 'Failed to replace the file.', variant: 'destructive' });

      setLocalFiles((prev) =>
        prev.map((f) =>
          f.envelopeItemId === envelopeItemId
            ? { ...f, isReplacing: false, isError: true }
            : f,
        ),
      );
    }
  };

  return { onReplacePdf };
}
