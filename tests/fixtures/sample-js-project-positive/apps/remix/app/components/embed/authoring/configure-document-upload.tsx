
declare const form: { getValues: (k: string) => string; setValue: (k: string, v: string) => void };

// File extension stripping /\.[^/.]+$/ — ASCII filename pattern, unicode flag adds no value.
function autoPopulateTitleFromFile(fileName: string): void {
  const currentTitle = form.getValues('title');
  if (!currentTitle) {
    const fileNameWithoutExtension = fileName.replace(/\.[^/.]+$/, '');
    form.setValue('title', fileNameWithoutExtension);
  }
}



declare const MAX_UPLOAD_SIZE_MB: number;
declare function buildDropzoneRejectionMessage(rejection: unknown): string;
declare function cn(...classes: (string | undefined | false | null)[]): string;
declare const Button: React.FC<{ type?: string; variant?: string; disabled?: boolean; className?: string; onClick?: () => void; children?: React.ReactNode }>;
declare const useToast: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const useFormContext: <T>() => { watch: (field: string) => unknown; setValue: (field: string, value: unknown) => void; formState: { isSubmitting: boolean } };
declare const useState: <T>(initial: T) => [T, (v: T) => void];
declare const useDropzone: (opts: unknown) => { getRootProps: () => Record<string, unknown>; getInputProps: () => Record<string, unknown>; isDragActive: boolean };
declare const React: { FC: unknown; ReactNode: unknown };

type AssetUploadProps = {
  isSubmitting?: boolean;
};

export const AssetUploadWidget = ({ isSubmitting = false }: AssetUploadProps) => {
  const { toast } = useToast();

  const form = useFormContext<{ assetData: unknown }>();

  const [isLoading, setIsLoading] = useState(false);

  const assetData = form.watch('assetData');

  const onFileDrop = async (acceptedFiles: File[]) => {
    try {
      const file = acceptedFiles[0];

      if (!file) {
        return;
      }

      setIsLoading(true);

      if (file.size > MAX_UPLOAD_SIZE_MB * 1024 * 1024) {
        toast({
          title: 'File too large',
          description: `Maximum file size is ${MAX_UPLOAD_SIZE_MB}MB`,
          variant: 'destructive',
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        form.setValue('assetData', e.target?.result);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      toast({ title: 'Upload failed', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const onFileReject = (rejections: unknown[]) => {
    toast({
      title: 'Invalid file',
      description: buildDropzoneRejectionMessage(rejections[0]),
      variant: 'destructive',
    });
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    onDropAccepted: onFileDrop,
    onDropRejected: onFileReject,
    disabled: isSubmitting || isLoading || !!assetData,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors',
        isDragActive && 'border-primary/50 bg-primary/5',
        (isSubmitting || isLoading) && 'cursor-not-allowed opacity-60',
      )}
    >
      <input {...getInputProps()} />
      {assetData ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm font-medium">File uploaded</p>
          <Button
            type="button"
            variant="ghost"
            disabled={isSubmitting}
            onClick={(e) => {
              (e as unknown as Event).stopPropagation();
              form.setValue('assetData', null);
            }}
          >
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-sm font-medium">{isDragActive ? 'Drop file here' : 'Drag & drop or click to upload'}</p>
          <p className="text-xs text-muted-foreground">PDF up to {MAX_UPLOAD_SIZE_MB}MB</p>
        </div>
      )}
    </div>
  );
};



declare const DragDropContext2: React.FC<{ onDragEnd: (result: unknown) => void; sensors?: unknown[]; children?: React.ReactNode }>;
declare const Droppable2: React.FC<{ droppableId: string; children: (provided: { droppableProps: Record<string, unknown>; innerRef: React.Ref<HTMLDivElement>; placeholder: React.ReactNode }) => React.ReactNode }>;
declare const Draggable2: React.FC<{ key: string; draggableId: string; index: number; isDragDisabled?: boolean; children: (provided: { innerRef: React.Ref<HTMLDivElement>; draggableProps: Record<string, unknown>; dragHandleProps: Record<string, unknown> }, snapshot: { isDragging: boolean }) => React.ReactNode }>;
declare const cn2: (...classes: (string | undefined | false | null)[]) => string;
declare const Tooltip2: React.FC<{ children?: React.ReactNode }>;
declare const TooltipTrigger2: React.FC<{ children?: React.ReactNode }>;
declare const TooltipContent2: React.FC<{ children?: React.ReactNode }>;
declare const React: { FC: unknown; ReactNode: unknown; Ref: unknown };
declare type SensorAPI = unknown;

type DraggableSignerRowProps = {
  signers: Array<{ id: string; nativeId: string; email: string; name: string; signingOrder?: number; role: string }>;
  isSigningOrderSequential: boolean;
  isSubmitting: boolean;
  canModifySigner: (id: string) => boolean;
  onDragEnd: (result: unknown) => void;
  renderSignerRow: (signer: DraggableSignerRowProps['signers'][number], index: number) => React.ReactNode;
  sensorApiRef: React.Ref<SensorAPI>;
};

export const DraggableSignerList = ({
  signers,
  isSigningOrderSequential,
  isSubmitting,
  canModifySigner,
  onDragEnd,
  renderSignerRow,
  sensorApiRef,
}: DraggableSignerRowProps) => {
  return (
    <DragDropContext2
      onDragEnd={onDragEnd}
      sensors={[
        (api: SensorAPI) => {
          (sensorApiRef as React.MutableRefObject<SensorAPI>).current = api;
        },
      ]}
    >
      <Droppable2 droppableId="signers">
        {(provided) => (
          <div
            {...provided.droppableProps}
            ref={provided.innerRef as React.Ref<HTMLDivElement>}
            className="flex w-full flex-col gap-y-2"
          >
            {signers.map((signer, index) => (
              <Draggable2
                key={`${signer.nativeId}-${signer.signingOrder}`}
                draggableId={signer.nativeId}
                index={index}
                isDragDisabled={
                  !isSigningOrderSequential ||
                  isSubmitting ||
                  !canModifySigner(signer.id) ||
                  !signer.signingOrder
                }
              >
                {(innerProvided, snapshot) => (
                  <div
                    ref={innerProvided.innerRef as React.Ref<HTMLDivElement>}
                    {...innerProvided.draggableProps}
                    {...innerProvided.dragHandleProps}
                    className={cn2('py-1', {
                      'pointer-events-none rounded-md bg-widget-foreground pt-2': snapshot.isDragging,
                    })}
                  >
                    {renderSignerRow(signer, index)}
                  </div>
                )}
              </Draggable2>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable2>
    </DragDropContext2>
  );
};



// [unknown-catch-variable] catch(error) — console.error with label + value; fixed toast; no property access
declare function uploadConfigDocument(file: File): Promise<{ documentId: string }>;
declare const uploadToast: (opts: { title: string; description: string; variant?: string }) => void;

async function handleConfigDocumentUpload(file: File): Promise<string | null> {
  try {
    const { documentId } = await uploadConfigDocument(file);
    uploadToast({ title: 'File uploaded', description: 'Your document has been uploaded successfully.' });
    return documentId;
  } catch (error) {
    console.error('Error uploading file', error);
    uploadToast({
      title: 'Upload failed',
      description: 'We could not upload your file. Please try again.',
      variant: 'destructive',
    });
    return null;
  }
}
