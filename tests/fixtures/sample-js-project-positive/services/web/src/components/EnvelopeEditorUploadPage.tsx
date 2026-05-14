
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useCallback<T extends (...args: any[]) => any>(fn: T, deps: any[]): T;
declare const useNavigate: () => (path: string) => void;
declare const useToast: () => { toast: (opts: any) => void };
declare const useMutation: (opts: any) => { mutateAsync: (...a: any[]) => Promise<any>; isPending: boolean };
declare const useDropzone: (opts: any) => { getRootProps: () => any; getInputProps: () => any; isDragActive: boolean; isDragReject: boolean };
declare const cn: (...args: any[]) => string;
declare const Button: any;
declare const Progress: any;
declare const Cloud: any;
declare const FileText: any;
declare const X: any;
declare const Loader2: any;
declare const AlertCircle: any;

const MAX_FILE_SIZE_MB = 25;

type UploadedFile = {
  name: string;
  sizeBytes: number;
  documentDataId: string;
};

type EnvelopeEditorUploadPageProps = {
  envelopeId: string;
  onUploaded: (documentDataId: string) => void;
};

export const EnvelopeEditorUploadPage = ({
  envelopeId,
  onUploaded,
}: EnvelopeEditorUploadPageProps) => {
  const { toast } = useToast();
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);

  const { mutateAsync: uploadDocument, isPending } = useMutation({
    onSuccess: (result: any, variables: any) => {
      setUploadedFile({
        name: variables.fileName,
        sizeBytes: variables.sizeBytes,
        documentDataId: result.documentDataId,
      });
      onUploaded(result.documentDataId);
    },
    onError: () => {
      toast({ title: 'Upload failed', variant: 'destructive' });
    },
  });

  const processFile = useCallback(
    async (file: File) => {
      setValidationError(null);

      if (file.type !== 'application/pdf') {
        setValidationError('Only PDF files are accepted.');
        return;
      }

      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setValidationError(`File must be smaller than ${MAX_FILE_SIZE_MB} MB.`);
        return;
      }

      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

      // Simulate progress since we're using base64
      setUploadProgress(0);
      const interval = setInterval(() => {
        setUploadProgress((p) => Math.min(p + 10, 90));
      }, 100);

      try {
        await uploadDocument({
          envelopeId,
          fileName: file.name,
          sizeBytes: file.size,
          data: base64,
        });
        setUploadProgress(100);
      } finally {
        clearInterval(interval);
      }
    },
    [envelopeId, uploadDocument],
  );

  const handleDropRejected = useCallback(() => {
    setValidationError('File type not accepted or file is too large.');
  }, []);

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    maxSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    multiple: false,
    disabled: isPending || !!uploadedFile,
    onDrop: (files: File[]) => {
      if (files.length > 0) void processFile(files[0]);
    },
    onDropRejected: handleDropRejected,
  });

  const handleRemoveFile = () => {
    setUploadedFile(null);
    setUploadProgress(0);
    setValidationError(null);
  };

  return (
    <div className="flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-xl space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Upload document</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a PDF to create your envelope. Max {MAX_FILE_SIZE_MB} MB.
          </p>
        </div>

        {!uploadedFile ? (
          <div
            {...getRootProps()}
            className={cn(
              'flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors',
              isDragActive && !isDragReject && 'border-primary bg-primary/5',
              isDragReject && 'border-destructive bg-destructive/5',
              !isDragActive && !isDragReject && 'border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30',
              (isPending) && 'cursor-not-allowed opacity-60',
            )}
          >
            <input {...getInputProps()} />

            <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
              {isPending ? (
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              ) : (
                <Cloud
                  className={cn(
                    'h-10 w-10',
                    isDragActive ? 'text-primary' : 'text-muted-foreground',
                  )}
                />
              )}

              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {isDragActive ? 'Drop your PDF here' : 'Drag and drop your PDF'}
                </p>
                <p className="text-xs text-muted-foreground">
                  or{' '}
                  <span className="text-primary underline underline-offset-2">browse files</span>
                </p>
              </div>
            </div>

            {isPending && uploadProgress > 0 && (
              <div className="w-full px-6 pb-4">
                <Progress value={uploadProgress} className="h-1.5" />
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <FileText className="h-8 w-8 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{uploadedFile.name}</p>
              <p className="text-xs text-muted-foreground">
                {(uploadedFile.sizeBytes / 1024 / 1024).toFixed(1)} MB
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleRemoveFile}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Remove file</span>
            </Button>
          </div>
        )}

        {validationError && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {validationError}
          </div>
        )}
      </div>
    </div>
  );
};



// Positive: argument-type-mismatch — array.map() with conditional spread immutable update.
// Items with matching id get a title/data update via spread; others pass through unchanged. No type mismatch.
declare function useState<T>(init: T): [T, (v: T) => void];
type AttachmentItem = { id: string; label: string; payload: Uint8Array };

function useAttachmentUpdater(items: AttachmentItem[]) {
  const [store, setStore] = useState<AttachmentItem[]>(items);

  async function replaceAttachment(targetId: string, file: File, newLabel: string) {
    const buf = await file.arrayBuffer();
    const payload = new Uint8Array(buf.slice(0));
    setStore(
      store.map((item) =>
        item.id === targetId ? { ...item, label: newLabel, payload } : item,
      ),
    );
  }

  return { store, replaceAttachment };
}




// Positive: argument-type-mismatch — Array.concat with mapped objects.
// existingAttachments.concat(data.map((item) => ({...}))) uses concat with a mapped object array; no type mismatch.
type AttachmentEntry = { id: string; filename: string; sizeBytes: number };

declare function useState<T>(init: T): [T, (v: T) => void];

function useAttachmentList(initial: AttachmentEntry[]) {
  const [attachments, setAttachments] = useState<AttachmentEntry[]>(initial);

  function appendUploads(uploads: Array<{ id: string; filename: string; sizeBytes: number }>) {
    setAttachments(
      attachments.concat(
        uploads.map((item) => ({
          id: item.id,
          filename: item.filename,
          sizeBytes: item.sizeBytes,
        })),
      ),
    );
  }

  return { attachments, appendUploads };
}




// Positive: argument-type-mismatch — form.setValue with nested key path ('meta.emailSettings').
// The value type flows from the DocumentEmailCheckboxes onChange prop, which matches the form field type.
declare function useFormContext_fb4768<T>(): {
  setValue: (key: string, value: unknown) => void;
  control: object;
};
declare function FormField_fb4768(props: {
  control: object;
  name: string;
  render: (p: { field: object }) => JSX.Element;
}): JSX.Element;
declare function Textarea_fb4768(props: { className?: string; [key: string]: unknown }): JSX.Element;
declare function FormControl_fb4768(props: { children: JSX.Element }): JSX.Element;
declare function FormMessage_fb4768(): JSX.Element;
declare function DocumentEmailSettings_fb4768(props: {
  value: object;
  onChange: (v: object) => void;
}): JSX.Element;

type EnvelopeMetaForm = { meta: { emailSettings: object; messageBody?: string } };

function EnvelopeEmailSettingsSection() {
  const form = useFormContext_fb4768<EnvelopeMetaForm>();

  return (
    <>
      <FormField_fb4768
        control={form.control}
        name="meta.messageBody"
        render={({ field }) => (
          <FormControl_fb4768>
            <Textarea_fb4768 className="h-16 resize-none bg-background" {...field} />
          </FormControl_fb4768>
        )}
      />
      <DocumentEmailSettings_fb4768
        value={{}}
        onChange={(value) => form.setValue('meta.emailSettings', value)}
      />
    </>
  );
}

