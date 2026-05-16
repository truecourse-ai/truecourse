
declare const DropzoneErrorCode: { TooManyFiles: string; FileTooLarge: string };
declare const rejections: Array<{ errors: Array<{ code: string }> }>;

function hasTooManyFilesError(rejections: Array<{ errors: Array<{ code: string }> }>) {
  return rejections.some((rejection) =>
    rejection.errors.some((error) => error.code === DropzoneErrorCode.TooManyFiles),
  );
}



// --- argument-type-mismatch FP: nested filter+find over array items ---
interface AttachmentItem {
  id: string;
  filename: string;
  size: number;
}

interface AttachmentGroup {
  groupId: string;
  attachments: AttachmentItem[];
}

declare const pendingUploads: AttachmentItem[];
declare const existingGroups: AttachmentGroup[];

function getNewUploads(): AttachmentItem[] {
  return pendingUploads.filter(
    (item) =>
      !existingGroups.find(
        (group) => group.attachments.find((attachment) => attachment.id === item.id),
      ),
  );
}



// --- argument-type-mismatch FP: Array.concat with mapped objects ---
interface UploadedFile {
  id: string;
  filename: string;
  url: string;
}

declare const existingFiles: UploadedFile[];
declare const newFileData: Array<{ id: string; filename: string; url: string }>;

function mergeUploadedFiles(): UploadedFile[] {
  return existingFiles.concat(
    newFileData.map((item) => ({
      id: item.id,
      filename: item.filename,
      url: item.url,
    }))
  );
}



// FP shape f7a7730e721f: array.map() with conditional spread immutable update — no type mismatch
declare const attachmentStore: { items: Array<{ id: string; label: string; payload: Uint8Array }> };
declare function setAttachmentStore(val: { items: Array<{ id: string; label: string; payload: Uint8Array }> }): void;

async function replaceAttachmentPayload(targetId: string, file: File, newLabel: string): Promise<void> {
  const arrayBuffer = await file.arrayBuffer();
  const fileData = new Uint8Array(arrayBuffer.slice(0));

  setAttachmentStore({
    items: attachmentStore.items.map((item) =>
      item.id === targetId ? { ...item, label: newLabel, payload: fileData } : item,
    ),
  });
}



// FP shape f9573ff26d81: arrayBuffer().slice(0) into Uint8Array then dynamic import and load — no type mismatch
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];
declare const PDF: { load: (data: Uint8Array) => Promise<{ getPageCount: () => number }> };

type ReplacementFile = { file: File; pageCount: number };

function useFileReplacement() {
  const [isDropping, setIsDropping] = useState(false);
  const [replacementFile, setReplacementFile] = useState<ReplacementFile | null>(null);

  async function handleFileDrop(file: File | null) {
    if (!file || isDropping) {
      return;
    }

    setIsDropping(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const fileData = new Uint8Array(arrayBuffer.slice(0));
      const pdfDoc = await PDF.load(fileData);

      setReplacementFile({
        file,
        pageCount: pdfDoc.getPageCount(),
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsDropping(false);
    }
  }

  return { replacementFile, handleFileDrop };
}
