
declare const setLocalDocuments: (updater: (prev: { items: Array<{ id: string; title: string }> }) => { items: Array<{ id: string; title: string }> }) => void;
declare const documentId: string;
declare const document: { fields: Array<{ itemId: string }>; items: Array<{ id: string; title: string }> };

function handleDocumentDelete() {
  setLocalDocuments({
    items: document.items.filter((item) => item.id !== documentId),
    fields: document.fields.filter((field) => field.itemId !== documentId),
  });
}



// --- argument-type-mismatch FP: optional-chain array map to JSX elements ---
interface DocumentAttachment {
  id: string;
  filename: string;
  fileSize: number;
  mimeType: string;
}

interface AttachmentResponse {
  data: DocumentAttachment[];
  total: number;
}

declare const attachments: AttachmentResponse | undefined;

function AttachmentList() {
  return (
    <ul>
      {attachments?.data.map((attachment) => (
        <li key={attachment.id}>
          <span>{attachment.filename}</span>
          <span>{attachment.fileSize} bytes</span>
        </li>
      ))}
    </ul>
  );
}
