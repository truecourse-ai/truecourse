
// E00: void promise.finally() with cleanup callback — no type mismatch.
declare const pendingOpsRef: { current: Set<Promise<void>> };

function trackOperation(op: Promise<void>): void {
  pendingOpsRef.current.add(op);
  void op.finally(() => {
    pendingOpsRef.current.delete(op);
  });
}



// E10: Promise .then() with ArrayBuffer → Uint8Array conversion — correct usage; no type mismatch.
declare const base64: { encode(data: Uint8Array): string };
declare const imageFile: { arrayBuffer(): Promise<ArrayBuffer> };

imageFile.arrayBuffer().then((buffer) => {
  const encoded = base64.encode(new Uint8Array(buffer));
  return encoded;
});



// E28: Promise .catch() with error callback — correct usage; no type mismatch.
interface NewUserPayload {
  email: string;
  name: string;
}

interface OrgOptions {
  skipPersonalOrganisation: boolean;
}

declare function onUserCreatedHook(user: NewUserPayload, opts: OrgOptions): Promise<void>;

const userToLink: NewUserPayload = { email: 'dev@example.com', name: 'Dev User' };

onUserCreatedHook(userToLink, { skipPersonalOrganisation: true }).catch((err: unknown) => {
  console.error('User created hook failed:', err);
});



// Shape: dynamic import with destructuring — valid async dynamic import, no type mismatch
export async function loadPdfLibrary() {
  const { PdfDocument } = await import('./pdf-document-impl');
  const doc = new PdfDocument();
  return doc;
}

export async function loadImageProcessor() {
  const { ImageProcessor } = await import('./image-processor-impl');
  return new ImageProcessor();
}



// --- FP shape: await on Promise<string> | string union — await is required for the Promise branch ---
declare function writeToClipboard(text: string): Promise<void>;

type ClipboardValue = Promise<string> | string;

async function copyToClipboard(text: ClipboardValue): Promise<void> {
  const resolved = await text;
  await writeToClipboard(resolved);
}



// --- FP shape: await on named union type alias (UploadValue = Promise<string> | string) ---
declare function persistToStorage(value: string): Promise<boolean>;

type UploadValue = Promise<string> | string;

async function handleUpload(value: UploadValue): Promise<boolean> {
  const resolvedValue = await value;
  return persistToStorage(resolvedValue);
}



// --- invalid-void-type shape: void as optional callback parameter return type ---
// `onResponse?: (response: R) => void` is valid and idiomatic TypeScript for
// optional callbacks whose return value is discarded. Not an invalid position.
export function useAutoSave<T, R>(
  saveFn: (data: T) => Promise<R>,
  delay?: number,
): {
  save: (data: T, onResponse?: (response: R) => void) => void;
  flush: () => Promise<void>;
} {
  return {
    save: (_data, _onResponse) => { /* debounced */ },
    flush: async () => { /* noop */ },
  };
}



// --- invalid-void-type shape: void as event listener callback return type ---
// `(event: StorageEvent) => void` matches the addEventListener contract and
// is valid TypeScript for event listener callbacks.
export function useStorageListener(
  key: string,
  callback: (event: StorageEvent) => void,
): () => void {
  const handler = (event: StorageEvent) => {
    if (event.key === key) {
      callback(event);
    }
  };

  window.addEventListener('storage', handler);

  return () => {
    window.removeEventListener('storage', handler);
  };
}



// --- invalid-void-type shape: void as optional callback return type (scheduleSave) ---
// `onResponse?: (response: R) => void` is standard TypeScript for optional
// callbacks whose return value is discarded. Not an invalid void position.
export function scheduleSave<T, R>(
  data: T,
  saveFn: (data: T) => Promise<R>,
  onResponse?: (response: R) => void,
  delay = 500,
): void {
  setTimeout(() => {
    saveFn(data).then((res) => {
      if (onResponse) onResponse(res);
    }).catch(console.error);
  }, delay);
}



// --- invalid-void-type shape: void as callback parameter return type (scroll hook) ---
// `(index: number) => void` is a valid TypeScript callback type; annotating
// the return as void allows any return value while signaling it is ignored.
export function useScrollToPage(
  scrollToItem: (index: number) => void,
): (page: number) => void {
  return (page: number) => {
    scrollToItem(page - 1);
  };
}



// --- invalid-void-type shape: void as Promise type parameter ---
// `Promise<void>` is the canonical TypeScript pattern for async functions that
// don't produce a meaningful value. TypeScript explicitly permits void as a
// type argument to Promise.
export function useEnvelopeAutosave<T>(
  saveFn: (data: T) => Promise<void>,
  delay = 1000,
): {
  schedule: (data: T) => void;
  flush: () => Promise<void>;
  isPending: boolean;
} {
  let pending = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastData: T | null = null;

  const flush = async (): Promise<void> => {
    if (lastData !== null) {
      await saveFn(lastData);
      lastData = null;
    }
  };

  return {
    schedule(data: T): void {
      lastData = data;
      pending = true;
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        flush().finally(() => { pending = false; });
      }, delay);
    },
    flush,
    get isPending() { return pending; },
  };
}
