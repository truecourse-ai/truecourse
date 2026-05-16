
// FP: onDragEnd handler returns void; the result is not captured anywhere.
declare function useCallback2<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function setState<T>(updater: (prev: T) => T): void;

type FileItem = { id: string; name: string; order: number };
type DropEvent = { source: { index: number }; destination: { index: number } | null };

declare const localFiles: FileItem[];
declare function syncFiles(files: FileItem[]): Promise<void>;

const onFileDragEnd = (result: DropEvent): void => {
  if (!result.destination) {
    return;
  }

  const items = [...localFiles];
  const [moved] = items.splice(result.source.index, 1);
  items.splice(result.destination.index, 0, moved!);

  syncFiles(items);
};



// safe-value-pass-no-property-access: catch(error) only console.error(error) and fixed toast; no property access
declare function downloadAuditLog(documentId: string): Promise<Blob>;
declare function triggerBrowserDownload(blob: Blob, filename: string): void;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleDownloadAuditLog(documentId: string): Promise<void> {
  try {
    const blob = await downloadAuditLog(documentId);
    triggerBrowserDownload(blob, `audit-log-${documentId}.csv`);
  } catch (error) {
    console.error(error);
    showToast('Failed to download audit log. Please try again.', 'error');
  }
}
