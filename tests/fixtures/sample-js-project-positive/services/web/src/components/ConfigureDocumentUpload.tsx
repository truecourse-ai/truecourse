
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useCallback<T extends (...args: any[]) => any>(fn: T, deps: any[]): T;
declare const useDropzone: (opts: any) => { getRootProps: () => any; getInputProps: () => any; isDragActive: boolean };
declare const useForm: (opts: any) => any;
declare const zodResolver: (schema: any) => any;
declare const z: any;
declare const cn: (...args: any[]) => string;
declare const Form: any;
declare const FormField: any;
declare const FormItem: any;
declare const FormLabel: any;
declare const FormControl: any;
declare const FormMessage: any;
declare const Cloud: any;

const APP_DOCUMENT_UPLOAD_SIZE_LIMIT = 25;

const ZDocumentUploadSchema = z.object({
  documentData: z.string().min(1, 'Please upload a document'),
});

type ConfigureDocumentUploadProps = {
  onUploaded: (documentDataId: string) => void;
  isLoading?: boolean;
  isSubmitting?: boolean;
  isPersisted?: boolean;
  documentData?: string | null;
  className?: string;
};

export const ConfigureDocumentUpload = ({
  onUploaded,
  isLoading = false,
  isSubmitting = false,
  isPersisted = false,
  documentData,
  className,
}: ConfigureDocumentUploadProps) => {
  const form = useForm({
    resolver: zodResolver(ZDocumentUploadSchema),
    defaultValues: { documentData: documentData ?? '' },
  });

  const onFileDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;

      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

      form.setValue('documentData', base64, { shouldValidate: true });
      onUploaded(base64);
    },
    [form, onUploaded],
  );

  const onDropRejected = useCallback(() => {
    form.setError('documentData', {
      type: 'manual',
      message: 'File type not accepted or file is too large.',
    });
  }, [form]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    maxSize: APP_DOCUMENT_UPLOAD_SIZE_LIMIT * 1024 * 1024,
    multiple: false,
    disabled: isSubmitting || isLoading || isPersisted,
    onDrop: (files: File[]) => {
      void onFileDrop(files);
    },
    onDropRejected,
  });

  return (
    <div className={className}>
      <Form {...form}>
        <FormField
          control={form.control}
          name="documentData"
          render={() => (
            <FormItem>
              <FormLabel required>Upload Document</FormLabel>

              <div className="relative">
                {!documentData ? (
                  <div className="relative">
                    <FormControl>
                      <div
                        {...getRootProps()}
                        className={cn(
                          'relative flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed bg-background transition',
                          {
                            'border-primary/50 bg-primary/5': isDragActive,
                            'hover:bg-muted/30': !isDragActive && !isSubmitting && !isLoading && !isPersisted,
                            'cursor-not-allowed opacity-60': isSubmitting || isLoading || isPersisted,
                          },
                        )}
                      >
                        <input {...getInputProps()} />

                        <div className="flex flex-col items-center justify-center gap-y-2 px-4 py-4 text-center">
                          <Cloud
                            className={cn('h-10 w-10', {
                              'text-primary': isDragActive,
                              'text-muted-foreground': !isDragActive,
                            })}
                          />

                          <div
                            className={cn('flex flex-col space-y-1', {
                              'text-primary': isDragActive,
                              'text-muted-foreground': !isDragActive,
                            })}
                          >
                            <p className="font-medium text-sm">
                              {isDragActive
                                ? 'Drop your document here'
                                : 'Drag and drop your document'}
                            </p>
                            <p className="text-xs">
                              or{' '}
                              <span className="text-primary underline underline-offset-2">
                                browse files
                              </span>
                            </p>
                          </div>
                        </div>
                      </div>
                    </FormControl>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-md border p-3">
                    <p className="flex-1 truncate text-sm">
                      Document uploaded
                    </p>
                  </div>
                )}
              </div>

              <FormMessage />
            </FormItem>
          )}
        />
      </Form>
    </div>
  );
};
