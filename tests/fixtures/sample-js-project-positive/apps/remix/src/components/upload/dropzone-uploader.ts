
declare function useDropzone(opts: {
  accept?: Record<string, string[]>;
  maxFiles?: number;
  maxSize?: number;
  multiple?: boolean;
  noClick?: boolean;
  noKeyboard?: boolean;
  noDrag?: boolean;
  onDrop?: (accepted: File[]) => void;
  onDropRejected?: (rejections: unknown[]) => void;
  onFileDialogCancel?: () => void;
}): { open: () => void; getInputProps: () => Record<string, unknown> };

declare function megabytesToBytes(mb: number): number;
declare function onFileUpload(file: File): Promise<void>;
declare function onFileRejected(rejections: unknown[]): Promise<void>;
declare const MAX_UPLOAD_SIZE_MB: number;

const { open: openFilePicker, getInputProps } = useDropzone({
  accept: { 'application/pdf': ['.pdf'] },
  maxFiles: 1,
  maxSize: megabytesToBytes(MAX_UPLOAD_SIZE_MB),
  multiple: false,
  noClick: true,
  noKeyboard: true,
  noDrag: false,
  onDrop: (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (file) {
      void onFileUpload(file);
    }
  },
  onDropRejected: (rejections) => void onFileRejected(rejections),
  onFileDialogCancel: () => {
    console.log('File dialog cancelled');
  },
});
