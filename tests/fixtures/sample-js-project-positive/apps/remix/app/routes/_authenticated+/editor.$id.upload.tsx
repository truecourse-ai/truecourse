// ContractEditorUploadPage — react-tsx FP shape
declare const useCurrentContractEditor: () => {
  contract: { id: number; contractItems: Array<{ id: string; title: string; order: number }> };
  setLocalContract: (fn: (prev: unknown) => unknown) => void;
  editorConfig: { contractItems: { allowMultiple: boolean; maxCount: number; allowedTypes: string[] } };
  isEmbedded: boolean;
  navigateToStep: (step: string) => void;
  registerExternalFlush: (fn: () => Promise<void>) => void;
  registerPendingMutation: (fn: () => Promise<void>) => void;
};
declare const useCurrentOrganisation_upload: () => { id: string; name: string };
declare const useLimits_upload: () => { maximumItemCount: number; remaining: number };
declare const useToast_upload: () => { toast: (opts: { title?: string; description?: string; variant?: string }) => void };
declare const useLingui_upload: () => { t: (s: TemplateStringsArray, ...args: unknown[]) => string; i18n: unknown };
declare const useState_upload: <T>(v: T) => [T, (v: T) => void];
declare const useEffect_upload: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useMemo_upload: <T>(fn: () => T, deps: unknown[]) => T;
declare const useRef_upload: <T>(v: T | null) => { current: T | null };
declare const trpc_upload: {
  contractItem: {
    createItems: { useMutation: () => { mutateAsync: (payload: unknown) => Promise<{ id: string; title: string }[]> } };
    replaceItemPdf: { useMutation: () => { mutateAsync: (payload: unknown) => Promise<void> } };
  };
};
declare const nanoid_upload: () => string;
declare const megabytesToBytes_upload: (mb: number) => number;
declare const APP_CONTRACT_UPLOAD_SIZE_LIMIT_upload: number;

type LocalContractFile = {
  id: string;
  title: string;
  contractItemId: string | null;
  isUploading: boolean;
  isReplacing: boolean;
  isError: boolean;
};

export const ContractEditorUploadPage = () => {
  const organisation = useCurrentOrganisation_upload();
  const { t } = useLingui_upload();
  const { maximumItemCount, remaining } = useLimits_upload();
  const { toast } = useToast_upload();

  const {
    contract,
    setLocalContract,
    editorConfig,
    isEmbedded,
    navigateToStep,
    registerExternalFlush,
    registerPendingMutation,
  } = useCurrentContractEditor();

  const { contractItems: uploadConfig } = editorConfig;

  const [localFiles, setLocalFiles] = useState_upload<LocalContractFile[]>(
    contract.contractItems
      .sort((a, b) => a.order - b.order)
      .map((item) => ({
        id: item.id,
        title: item.title,
        contractItemId: item.id,
        isUploading: false,
        isReplacing: false,
        isError: false,
      })),
  );

  const { mutateAsync: createItems } = trpc_upload.contractItem.createItems.useMutation();
  const { mutateAsync: replaceItemPdf } = trpc_upload.contractItem.replaceItemPdf.useMutation();

  const pendingUploads = useMemo_upload(() => localFiles.filter((f) => f.isUploading), [localFiles]);

  const handleFileDrop = async (acceptedFiles: File[]) => {
    const sizeLimit = megabytesToBytes_upload(APP_CONTRACT_UPLOAD_SIZE_LIMIT_upload);
    const oversized = acceptedFiles.filter((f) => f.size > sizeLimit);
    if (oversized.length > 0) {
      toast({
        title: t`File too large`,
        description: t`One or more files exceed the maximum allowed size.`,
        variant: 'destructive',
      });
      return;
    }
    const newEntries: LocalContractFile[] = acceptedFiles.map((f) => ({
      id: nanoid_upload(),
      title: f.name.replace(/\.pdf$/i, ''),
      contractItemId: null,
      isUploading: true,
      isReplacing: false,
      isError: false,
    }));
    setLocalFiles((prev) => [...prev, ...newEntries]);
    try {
      const created = await createItems({ contractId: contract.id, files: acceptedFiles });
      setLocalFiles((prev) =>
        prev.map((entry) => {
          const match = created.find((c) => c.title === entry.title);
          if (!match) return entry;
          return { ...entry, contractItemId: match.id, isUploading: false };
        }),
      );
    } catch {
      setLocalFiles((prev) =>
        prev.map((entry) =>
          newEntries.some((n) => n.id === entry.id) ? { ...entry, isUploading: false, isError: true } : entry,
        ),
      );
      toast({ title: t`Upload failed`, variant: 'destructive' });
    }
  };

  useEffect_upload(() => {
    registerExternalFlush(async () => {
      if (pendingUploads.length > 0) {
        toast({ description: t`Please wait for uploads to complete.` });
        throw new Error('Pending uploads');
      }
    });
  }, [pendingUploads.length, registerExternalFlush, toast, t]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t`Upload Contract Files`}</h2>
          <p className="text-sm text-muted-foreground">
            {remaining > 0 ? t`You can upload up to ${remaining} more file(s).` : t`Upload limit reached.`}
          </p>
        </div>
        {!isEmbedded && (
          <button
            onClick={() => navigateToStep('recipients')}
            className="rounded bg-primary px-4 py-2 text-sm text-white"
            disabled={localFiles.length === 0 || pendingUploads.length > 0}
          >
            {t`Continue`}
          </button>
        )}
      </div>

      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-muted-foreground">{t`Drag and drop PDF files here, or click to select`}</p>
        <input
          type="file"
          accept="application/pdf"
          multiple={uploadConfig.allowMultiple}
          className="hidden"
          onChange={(e) => handleFileDrop(Array.from(e.target.files ?? []))}
        />
      </div>

      {localFiles.length > 0 && (
        <ul className="space-y-2">
          {localFiles.map((file) => (
            <li key={file.id} className="flex items-center gap-3 rounded border border-border p-3">
              <span className="flex-1 truncate text-sm">{file.title}</span>
              {file.isUploading && <span className="text-xs text-muted-foreground">{t`Uploading...`}</span>}
              {file.isError && <span className="text-xs text-destructive">{t`Error`}</span>}
              <button
                onClick={() => setLocalFiles((prev) => prev.filter((f) => f.id !== file.id))}
                className="text-muted-foreground hover:text-destructive"
                aria-label={t`Remove file`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
