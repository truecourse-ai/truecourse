import { useEffect, useState } from 'react';

declare const Dialog: (props: { open: boolean; onOpenChange: (v: boolean) => void; children: JSX.Element }) => JSX.Element;
declare const DialogTrigger: (props: { asChild?: boolean; onClick?: (e: unknown) => void; children: JSX.Element }) => JSX.Element;
declare const DialogContent: (props: { children: JSX.Element }) => JSX.Element;
declare const DialogHeader: (props: { children: JSX.Element }) => JSX.Element;
declare const DialogTitle: (props: { children: JSX.Element | string }) => JSX.Element;
declare const DialogDescription: (props: { children: JSX.Element | string }) => JSX.Element;
declare const DialogFooter: (props: { children: JSX.Element }) => JSX.Element;
declare const DialogClose: (props: { asChild?: boolean; children: JSX.Element }) => JSX.Element;
declare const Button: (props: { type?: 'button' | 'submit'; variant?: 'ghost' | 'secondary' | 'destructive'; size?: 'sm' | 'md'; loading?: boolean; disabled?: boolean; onClick?: () => void; className?: string; children?: JSX.Element | string }) => JSX.Element;
declare const FormLabel: (props: { children: JSX.Element | string }) => JSX.Element;
declare const Input: (props: { value: string; onChange: (e: { target: { value: string } }) => void; placeholder?: string; disabled?: boolean; className?: string }) => JSX.Element;
declare const Alert: (props: { variant?: 'warning' | 'info'; children: JSX.Element }) => JSX.Element;
declare const AlertDescription: (props: { children: JSX.Element | string }) => JSX.Element;
declare const FileGlyph: (props: { className?: string }) => JSX.Element;
declare const UploadGlyph: (props: { className?: string }) => JSX.Element;
declare const XGlyph: (props: { className?: string }) => JSX.Element;
declare const WarnGlyph: (props: { className?: string }) => JSX.Element;
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string; duration?: number }) => void };
declare function useDropzone(opts: { accept: Record<string, string[]>; maxFiles: number; maxSize: number; disabled: boolean; onDrop: (files: File[]) => void; onDropRejected: (rejections: Array<{ reason: string }>) => void }): { getRootProps: () => Record<string, unknown>; getInputProps: () => Record<string, unknown>; isDragActive: boolean };
declare function classNames(...parts: Array<string | false | undefined>): string;
declare function bytesFromMegabytes(mb: number): number;
declare function describeRejections(rejections: Array<{ reason: string }>): string;
declare function loadPdfPageCount(buffer: Uint8Array): Promise<number>;

const REPORT_UPLOAD_LIMIT_MB = 25;

export type ReportTemplateEditDialogProps = {
  readonly template: { id: string; title: string; pageCount: number };
  readonly canRenameTemplate: boolean;
  readonly trigger: JSX.Element;
  readonly onSubmitTemplate: (payload: { id: string; title: string; file: File; pageCount: number }) => Promise<void>;
};

export const ReportTemplateEditDialog = ({
  template,
  canRenameTemplate,
  trigger,
  onSubmitTemplate,
}: ReportTemplateEditDialogProps): JSX.Element => {
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState(template.title);
  const [replacementFile, setReplacementFile] = useState<{ file: File; pageCount: number } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dropRejected = (rejections: Array<{ reason: string }>): void => {
    toast({
      title: 'Upload failed',
      description: describeRejections(rejections),
      duration: 5000,
      variant: 'destructive',
    });
  };

  const onFileDrop = async (files: File[]): Promise<void> => {
    const file = files[0];
    if (!file || isUploading) {
      return;
    }
    setIsUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const fileData = new Uint8Array(arrayBuffer.slice(0));
      const pageCount = await loadPdfPageCount(fileData);
      setReplacementFile({ file, pageCount });
    } catch (err) {
      console.error(err);
      toast({
        title: 'Failed to read file',
        description: 'The file is not a valid PDF.',
        variant: 'destructive',
      });
    }
    setIsUploading(false);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    maxSize: bytesFromMegabytes(REPORT_UPLOAD_LIMIT_MB),
    disabled: isSubmitting,
    onDrop: (files) => { void onFileDrop(files); },
    onDropRejected: dropRejected,
  });

  const onSubmit = async (): Promise<void> => {
    if (isUploading || !replacementFile) {
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmitTemplate({
        id: template.id,
        title,
        file: replacementFile.file,
        pageCount: replacementFile.pageCount,
      });
      setIsOpen(false);
    } catch {
      toast({
        title: 'Failed to update template',
        description: 'Something went wrong while updating the report template.',
        variant: 'destructive',
      });
    }
    setIsSubmitting(false);
  };

  useEffect(() => {
    if (!isOpen) {
      setTitle(template.title);
      setReplacementFile(null);
      setIsUploading(false);
    }
  }, [isOpen, template.title]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const hasPageMismatch = replacementFile !== null && replacementFile.pageCount < template.pageCount;

  return (
    <Dialog open={isOpen} onOpenChange={(value) => !isSubmitting && setIsOpen(value)}>
      <DialogTrigger onClick={(e: unknown) => (e as { stopPropagation?: () => void }).stopPropagation?.()} asChild>
        {trigger}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Report Template</DialogTitle>
          <DialogDescription>Update the title or replace the PDF file.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { (e as unknown as { preventDefault: () => void }).preventDefault(); void onSubmit(); }}>
          <fieldset disabled={isSubmitting} className="space-y-4">
            <div>
              <FormLabel>Template Title</FormLabel>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Template Title"
                disabled={!canRenameTemplate}
              />
            </div>
            <div>
              <FormLabel>Replace PDF</FormLabel>
              {replacementFile ? (
                <div className="mt-1.5 space-y-2">
                  <div className="flex items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2">
                    <div className="flex min-w-0 items-center space-x-2">
                      <FileGlyph className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-sm">{replacementFile.file.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {formatFileSize(replacementFile.file.size)}
                          {isUploading ? ' · …' : ` · ${replacementFile.pageCount} pages`}
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setReplacementFile(null)}
                    >
                      <XGlyph className="h-4 w-4" />
                    </Button>
                  </div>
                  {hasPageMismatch && (
                    <Alert variant="warning">
                      <AlertDescription>
                        <span><WarnGlyph className="h-4 w-4" /> The new PDF has fewer pages than the current one. Some annotations may be removed.</span>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              ) : (
                <div
                  {...getRootProps()}
                  className={classNames(
                    'mt-1.5 flex cursor-pointer items-center justify-center rounded-md border border-border border-dashed px-4 py-4 transition-colors',
                    isDragActive
                      ? 'border-primary/50 bg-primary/5'
                      : 'hover:border-muted-foreground/50 hover:bg-muted/50',
                  )}
                >
                  <input {...getInputProps()} />
                  <div className="flex items-center space-x-2 text-muted-foreground text-sm">
                    <UploadGlyph className="h-4 w-4" />
                    <span>Drop PDF here or click to select</span>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">Cancel</Button>
              </DialogClose>
              <Button
                type="submit"
                loading={isSubmitting}
                disabled={isUploading || !replacementFile}
              >
                Update
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
};
