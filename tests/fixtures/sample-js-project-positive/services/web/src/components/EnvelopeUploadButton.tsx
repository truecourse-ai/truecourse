
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useRef<T>(init: T | null): { current: T | null };
declare const useToast: () => { toast: (opts: any) => void };
declare const useMutation: (opts: any) => { mutateAsync: (...a: any[]) => Promise<any>; isPending: boolean };
declare const cn: (...args: any[]) => string;
declare const Button: any;
declare const Upload: any;
declare const Loader2: any;

const ACCEPTED_MIME_TYPES = ['application/pdf'];
const MAX_FILE_SIZE_MB = 25;

type EnvelopeUploadButtonProps = {
  onUploaded: (documentDataId: string) => void;
  disabled?: boolean;
  className?: string;
};

export const EnvelopeUploadButton = ({
  onUploaded,
  disabled = false,
  className,
}: EnvelopeUploadButtonProps) => {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const { mutateAsync: uploadDocument, isPending } = useMutation({
    onSuccess: (result: any) => {
      onUploaded(result.documentDataId);
    },
    onError: () => {
      toast({ title: 'Upload failed. Please try again.', variant: 'destructive' });
    },
  });

  const processFile = async (file: File) => {
    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      toast({ title: 'Only PDF files are supported.', variant: 'destructive' });
      return;
    }

    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      toast({
        title: `File size must be under ${MAX_FILE_SIZE_MB} MB.`,
        variant: 'destructive',
      });
      return;
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    await uploadDocument({ fileName: file.name, data: base64 });
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await processFile(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) await processFile(file);
  };

  return (
    <div
      className={cn('relative', className)}
      onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="sr-only"
        onChange={handleChange}
        disabled={disabled || isPending}
      />

      <Button
        type="button"
        variant={isDragging ? 'default' : 'outline'}
        onClick={() => inputRef.current?.click()}
        disabled={disabled || isPending}
        className="w-full"
      >
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <Upload className="mr-2 h-4 w-4" />
            {isDragging ? 'Drop PDF here' : 'Upload PDF'}
          </>
        )}
      </Button>
    </div>
  );
};
