
// FP: React component with async upload state management — standard React framework structure
declare const useIsEmbedded: () => boolean;
declare const uploadEnvelopeFile: (file: File) => Promise<{ id: string; title: string }>;
declare const replaceEnvelopeItem: (itemId: string, file: File) => Promise<{ id: string; title: string }>;
declare const useToast: () => { toast: (opts: { title: string; variant?: string }) => void };

type LocalFile = {
  id: string;
  envelopeItemId?: string;
  title: string;
  isUploading: boolean;
  isReplacing: boolean;
  isError: boolean;
};

type FileReplaceHandlerProps = {
  localFiles: LocalFile[];
  setLocalFiles: React.Dispatch<React.SetStateAction<LocalFile[]>>;
  envelopeId: string;
};

export function useFileReplaceHandler({ localFiles, setLocalFiles, envelopeId }: FileReplaceHandlerProps) {
  const isEmbedded = useIsEmbedded();
  const { toast } = useToast();

  const onReplacePdf = async (envelopeItemId: string, file: File) => {
    setLocalFiles((prev) =>
      prev.map((f) => (f.envelopeItemId === envelopeItemId ? { ...f, isReplacing: true } : f)),
    );

    try {
      if (isEmbedded) {
        // For embedded mode, store the file data locally on the envelope item.
        const reader = new FileReader();
        await new Promise<void>((resolve, reject) => {
          reader.onload = () => resolve();
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        setLocalFiles((prev) =>
          prev.map((f) =>
            f.envelopeItemId === envelopeItemId
              ? { ...f, isReplacing: false, title: file.name }
              : f,
          ),
        );
      } else {
        const result = await replaceEnvelopeItem(envelopeItemId, file);

        setLocalFiles((prev) =>
          prev.map((f) =>
            f.envelopeItemId === envelopeItemId
              ? { ...f, isReplacing: false, title: result.title, id: result.id }
              : f,
          ),
        );
      }
    } catch {
      toast({ title: 'Failed to replace the file.', variant: 'destructive' });

      setLocalFiles((prev) =>
        prev.map((f) =>
          f.envelopeItemId === envelopeItemId
            ? { ...f, isReplacing: false, isError: true }
            : f,
        ),
      );
    }
  };

  return { onReplacePdf };
}


// Shape: typed object with spread meta and boolean flags derived from configuration — no type mismatch
declare function createEmbeddedEnvelope(opts: {
  title: string;
  documentDataId: string;
  externalId?: string;
  meta: Record<string, unknown>;
  signers: Array<{ name: string; email: string; role: string; fields: any[] }>;
}): Promise<{ id: string }>;
declare function uploadEnvelopeDocument(
  opts: { arrayBuffer: () => Promise<ArrayBuffer>; name: string; type: string },
): Promise<{ id: string }>;
const SignatureMode = { DRAW: 'DRAW', TYPE: 'TYPE', UPLOAD: 'UPLOAD' };

export async function initiateEmbeddedEnvelope(config: {
  title: string;
  file: { data: { buffer: ArrayBuffer }; name: string; type: string } | null;
  meta: { externalId?: string; signatureModes?: string[]; [k: string]: unknown };
  signers: Array<{ name: string; email: string; role: string }>;
  fields: Array<{ signerEmail: string; pageX: number; pageY: number; [k: string]: unknown }>;
}) {
  if (!config.file) {
    throw new Error('No document configured');
  }

  const fileData = await uploadEnvelopeDocument({
    arrayBuffer: async () => Promise.resolve(config.file!.data.buffer),
    name: config.file.name,
    type: config.file.type,
  });

  const modes = config.meta.signatureModes ?? [];

  return createEmbeddedEnvelope({
    title: config.title,
    documentDataId: fileData.id,
    externalId: config.meta.externalId,
    meta: {
      ...config.meta,
      drawEnabled: modes.length === 0 || modes.includes(SignatureMode.DRAW),
      typeEnabled: modes.length === 0 || modes.includes(SignatureMode.TYPE),
      uploadEnabled: modes.length === 0 || modes.includes(SignatureMode.UPLOAD),
    },
    signers: config.signers.map((s) => ({
      name: s.name,
      email: s.email,
      role: s.role,
      fields: config.fields
        .filter((f) => f.signerEmail === s.email)
        .map<any>((f) => ({ ...f })),
    })),
  });
}



// Shape: useEffect calling void async procedure — standard effect pattern, no type mismatch
declare function useEffect51(fn: () => void, deps?: unknown[]): void;
declare function executeSigningAuthProcedure(opts: {
  onReauthFormSubmit: (authOptions: unknown) => Promise<void>;
  actionTarget: string;
}): Promise<void>;
declare const selectedSignatureType: string;
declare const currentField: { inserted: boolean; type: string };
declare function onSignField(authOptions: unknown): Promise<void>;
declare const shouldAutoSubmit: boolean;

useEffect51(() => {
  if (!currentField.inserted && selectedSignatureType) {
    void executeSigningAuthProcedure({
      onReauthFormSubmit: async (authOptions) => onSignField(authOptions),
      actionTarget: currentField.type,
    });
  }
}, [selectedSignatureType]);

useEffect51(() => {
  if (shouldAutoSubmit) {
    void executeSigningAuthProcedure({
      onReauthFormSubmit: async (authOptions) => onSignField(authOptions),
      actionTarget: currentField.type,
    });
  }
}, []);



// Shape: dynamic import of PDF lib, arrayBuffer().slice(0) into Uint8Array — no type mismatch
declare function useState54<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];
declare const PDFLib: { load: (data: Uint8Array) => Promise<{ getPageCount: () => number }> };

type ReplacedEnvelopeItem = { file: File; pageCount: number };

export function useEnvelopeItemReplacement() {
  const [isProcessing, setIsProcessing] = useState54(false);
  const [replacedItem, setReplacedItem] = useState54<ReplacedEnvelopeItem | null>(null);

  async function handleItemFileDrop(file: File | null) {
    if (!file || isProcessing) {
      return;
    }

    setIsProcessing(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const fileData = new Uint8Array(arrayBuffer.slice(0));
      const pdfDoc = await PDFLib.load(fileData);

      setReplacedItem({
        file,
        pageCount: pdfDoc.getPageCount(),
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  }

  return { replacedItem, handleItemFileDrop };
}

