
// --- no-void shape: module-level-or-non-react-async-init (void resource.cleanup() in catch) ---
declare const pdfPage: { cleanup: () => Promise<void> };

async function renderPdfPage(): Promise<Uint8Array> {
  try {
    return new Uint8Array(0);
  } catch (err) {
    void pdfPage.cleanup();
    throw err;
  }
}



// --- no-void shape: void-with-promise-chain (void worker.terminate().catch(console.error)) ---
declare const workerTask: { terminate: () => Promise<void> };

async function processDocument(): Promise<void> {
  try {
    // processing...
  } finally {
    void workerTask.terminate().catch(console.error);
  }
}
