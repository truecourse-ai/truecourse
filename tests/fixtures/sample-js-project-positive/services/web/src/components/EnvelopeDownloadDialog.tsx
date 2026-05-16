
declare function useState<T>(init: T): [T, (v: T) => void];
declare const useToast: () => { toast: (opts: any) => void };
declare const Dialog: any;
declare const DialogContent: any;
declare const DialogHeader: any;
declare const DialogTitle: any;
declare const DialogDescription: any;
declare const DialogFooter: any;
declare const Button: any;
declare const RadioGroup: any;
declare const RadioGroupItem: any;
declare const Label: any;
declare const Download: any;
declare const FileText: any;
declare const Loader2: any;
declare const cn: (...args: any[]) => string;

type DownloadFormat = 'pdf' | 'pdf-with-audit' | 'csv';

type EnvelopeDownloadDialogProps = {
  open: boolean;
  envelopeId: string;
  envelopeTitle: string;
  onOpenChange: (open: boolean) => void;
};

export const EnvelopeDownloadDialog = ({
  open,
  envelopeId,
  envelopeTitle,
  onOpenChange,
}: EnvelopeDownloadDialogProps) => {
  const { toast } = useToast();
  const [format, setFormat] = useState<DownloadFormat>('pdf');
  const [isDownloading, setIsDownloading] = useState(false);

  const formatOptions: { value: DownloadFormat; label: string; description: string }[] = [
    {
      value: 'pdf',
      label: 'Signed PDF',
      description: 'The completed document with all signatures embedded.',
    },
    {
      value: 'pdf-with-audit',
      label: 'PDF with audit log',
      description: 'Signed document plus a full audit trail appendix.',
    },
    {
      value: 'csv',
      label: 'Field data (CSV)',
      description: 'All field values from this envelope as a spreadsheet.',
    },
  ];

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch(
        `/api/envelopes/${envelopeId}/download?format=${format}`,
        { method: 'GET' },
      );

      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${envelopeTitle}.${format === 'csv' ? 'csv' : 'pdf'}`;
      a.click();
      URL.revokeObjectURL(url);

      onOpenChange(false);
    } catch {
      toast({ title: 'Download failed. Please try again.', variant: 'destructive' });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Download Envelope</DialogTitle>
          <DialogDescription>
            Choose the format for downloading "{envelopeTitle}".
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={format}
          onValueChange={(v: DownloadFormat) => setFormat(v)}
          className="space-y-3"
        >
          {formatOptions.map((opt) => (
            <label
              key={opt.value}
              htmlFor={opt.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors',
                format === opt.value
                  ? 'border-primary bg-primary/5'
                  : 'hover:bg-muted/50',
              )}
            >
              <RadioGroupItem id={opt.value} value={opt.value} className="mt-0.5" />
              <div>
                <p className="text-sm font-medium">{opt.label}</p>
                <p className="text-xs text-muted-foreground">{opt.description}</p>
              </div>
            </label>
          ))}
        </RadioGroup>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isDownloading}
          >
            Cancel
          </Button>

          <Button onClick={handleDownload} disabled={isDownloading}>
            {isDownloading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Downloading…
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Download
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};


// Popover UI component (non-route) using tRPC useQuery — error boundary coverage comes from parent layout route
declare function useQuery(opts: object): { data: { attachments: Array<{ id: string; name: string }> } | undefined; isLoading: boolean };

export function AttachmentsPreviewPanel({ envelopeId }: { envelopeId: string }) {
  // Non-route component — no per-component ErrorBoundary needed;
  // errors propagate to the parent route's ErrorBoundary.
  const { data, isLoading } = useQuery({ queryKey: ['envelope', envelopeId, 'attachments'] });
  const attachments = data?.attachments ?? [];

  if (isLoading) return <span className="text-sm text-muted-foreground">Loading...</span>;

  return (
    <ul className="space-y-1">
      {attachments.map((a) => (
        <li key={a.id} className="text-sm">{a.name}</li>
      ))}
    </ul>
  );
}

