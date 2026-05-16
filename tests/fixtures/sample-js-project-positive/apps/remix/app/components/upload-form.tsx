
// FP shape: tRPC useMutation with onSuccess callback; no type mismatch
declare const trpc: { document: { upload: { useMutation: (opts: { onSuccess: (data: unknown) => void }) => { mutate: (args: unknown) => void } } } };
declare function setLocalDocument(doc: unknown): void;

function UploadForm() {
  const { mutate } = trpc.document.upload.useMutation({
    onSuccess: (data) => setLocalDocument(data),
  });
  return <button onClick={() => mutate({ file: null })}>Upload</button>;
}



// --- argument-type-mismatch FP: useDropzone options object with accept/onDropAccepted ---
declare function useDropzone(options: { accept?: Record<string, string[]>; onDropAccepted?: (files: File[]) => void; multiple?: boolean }): { getRootProps: () => object; getInputProps: () => object };

function AvatarDropZone({ onFileSelected }: { onFileSelected: (file: File) => void }) {
  const { getRootProps, getInputProps } = useDropzone({
    accept: { 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'] },
    onDropAccepted: (files) => {
      if (files[0]) onFileSelected(files[0]);
    },
    multiple: false,
  });
  return (
    <div {...getRootProps()}>
      <input {...getInputProps()} />
      <span>Drop image here</span>
    </div>
  );
}



// --- argument-type-mismatch FP: cn() with ref and spread props on div ---
declare function cn(...classes: (string | undefined | null | false)[]): string;
declare function useRef<T>(init: T | null): { current: T | null };

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> { title?: string; }

const Panel = React.forwardRef<HTMLDivElement, PanelProps>(function Panel(
  { className, title, children, ...props },
  ref,
) {
  return (
    <div ref={ref} className={cn('rounded border p-4', className)} {...props}>
      {title && <h2 className="font-semibold">{title}</h2>}
      {children}
    </div>
  );
});



// --- argument-type-mismatch FP: files.filter().map() chain building transformed list ---
interface UploadedFile { id: string; name: string; size: number; mimeType: string; clientId: string; }
interface EnvelopeItem { fileId: string; displayName: string; clientId: string; orderIndex: number; }

function buildEnvelopeItems(files: UploadedFile[], existingItems: EnvelopeItem[]): EnvelopeItem[] {
  return files
    .filter((f) => !existingItems.some((item) => item.fileId === f.id))
    .map((f, index) => ({
      fileId: f.id,
      displayName: f.name,
      clientId: f.clientId,
      orderIndex: existingItems.length + index,
    }));
}



// --- argument-type-mismatch FP: cn() with string arguments and className prop ---
declare function cn(...args: (string | undefined | null | false)[]): string;

interface GridLayoutProps { className?: string; columns?: 1 | 2 | 3; children?: React.ReactNode; }

function GridLayout({ className, columns = 2, children }: GridLayoutProps) {
  const colClass = columns === 3 ? 'grid-cols-3' : columns === 2 ? 'grid-cols-2' : 'grid-cols-1';
  return (
    <div className={cn('grid gap-4', colClass, className)}>
      {children}
    </div>
  );
}



// --- argument-type-mismatch FP: React.forwardRef with matching generic type params ---
interface CardContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'outlined';
}

const CardContainer = React.forwardRef<HTMLDivElement, CardContainerProps>(function CardContainer(
  { variant = 'default', className, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`card card--${variant} ${className ?? ''}`}
      {...props}
    >
      {children}
    </div>
  );
});



// Shape: React.forwardRef wrapping a component — valid forwardRef pattern, no type mismatch
declare const React: {
  forwardRef: <T, P>(render: (props: P, ref: React.Ref<T>) => React.ReactElement | null) => React.ForwardRefExoticComponent<React.PropsWithoutRef<P> & React.RefAttributes<T>>;
  useId: () => string;
  createContext: <T>(val: T) => { Provider: React.ComponentType<{ value: T; children?: React.ReactNode }> };
};

type CardContextValue = { id: string };
const CardContext = React.createContext<CardContextValue>({ id: '' });

type CardItemProps = React.HTMLAttributes<HTMLDivElement> & { className?: string };

const CardItem = React.forwardRef<HTMLDivElement, CardItemProps>(({ className, ...props }, ref) => {
  const id = React.useId();
  return (
    <CardContext.Provider value={{ id }}>
      <div ref={ref} className={`card-item ${className ?? ''}`} {...props} />
    </CardContext.Provider>
  );
});



// Shape: onDropRejected callback wrapping handler with void — valid event handler wrapping, no type mismatch
declare function onFileDropRejected(rejections: Array<{ file: File; errors: Array<{ code: string; message: string }> }>): Promise<void>;

declare const useDropzone: (opts: {
  onDropRejected?: (rejections: Array<{ file: File; errors: Array<{ code: string; message: string }> }>) => void;
  accept?: Record<string, string[]>;
  maxFiles?: number;
}) => { open: () => void; getInputProps: () => Record<string, unknown> };

const dropzone = useDropzone({
  accept: { 'application/pdf': ['.pdf'] },
  maxFiles: 1,
  onDropRejected: (fileRejections) => void onFileDropRejected(fileRejections),
});



// Shape: array.map() rendering Draggable components in JSX list — standard JSX list, no type mismatch
declare const uploadedFiles: Array<{ id: string; name: string; size: number }>;
declare function DraggableItem(props: { key: string; draggableId: string; index: number; children: React.ReactNode }): JSX.Element;

export function FileListSnippet() {
  return (
    <div>
      {uploadedFiles.map((file, index) => (
        <DraggableItem
          key={file.id}
          draggableId={file.id}
          index={index}
        >
          <div className="file-row">
            <span>{file.name}</span>
            <span>{file.size} bytes</span>
          </div>
        </DraggableItem>
      ))}
    </div>
  );
}



// Shape: <div className={cn(...)} {...props} /> spreading React.HTMLAttributes onto div — correctly typed JSX spread
declare function cn(...classes: (string | undefined | null | false)[]): string;

type SectionPanelProps = React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'muted' };

export function SectionPanel({ className, variant = 'default', ...props }: SectionPanelProps) {
  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        variant === 'muted' && 'bg-muted',
        className,
      )}
      {...props}
    />
  );
}
