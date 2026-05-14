
// FF00 — react-dropzone useDropzone with options object; all types match
declare function useFileZone(opts: {
  accept: Record<string, string[]>;
  maxFiles: number;
  maxSize: number;
  disabled: boolean;
  onDrop: (files: File[]) => void;
  onDropRejected: (fileRejections: Array<{ file: File; errors: Array<{ code: string }> }>) => void;
}): { getRootProps: () => Record<string, unknown>; getInputProps: () => Record<string, unknown>; isDragActive: boolean };
declare const uploadSizeLimit: number;
declare const isSubmitting: boolean;
declare function handleFileDrop(files: File[]): Promise<void>;
declare function handleFileDropRejected(rejections: Array<{ file: File; errors: Array<{ code: string }> }>): void;

const { getRootProps, getInputProps, isDragActive } = useFileZone({
  accept: { 'application/pdf': ['.pdf'] },
  maxFiles: 1,
  maxSize: uploadSizeLimit,
  disabled: isSubmitting,
  onDrop: (files) => void handleFileDrop(files),
  onDropRejected: handleFileDropRejected,
});



// --- argument-type-mismatch FP: React state updater filter by id ---
declare function useState<T>(init: T): [T, (updater: T | ((prev: T) => T)) => void];

interface UploadingFile {
  uploadId: string;
  filename: string;
  progress: number;
}

function FileUploadManager() {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);

  function removeUploadingFile(uploadId: string): void {
    setUploadingFiles((prev) => prev.filter((uploadingFile) => uploadingFile.uploadId !== uploadId));
  }

  return null;
}
