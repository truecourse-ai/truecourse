
declare function loadPdfPages(url: string, signal: AbortSignal): Promise<{ pageNumber: number }[]>;
declare function setPages(pages: { pageNumber: number }[]): void;
declare function setLoadingState(state: 'loaded' | 'error'): void;
declare function showToast(opts: { title: string; description: string }): void;

async function renderPdf(url: string, signal: AbortSignal): Promise<void> {
  let isCancelled = false;
  signal.addEventListener('abort', () => { isCancelled = true; });
  try {
    const pages = await loadPdfPages(url, signal);
    if (isCancelled) return;
    setPages(pages);
    setLoadingState('loaded');
  } catch (err) {
    if (isCancelled) return;
    console.error(err);
    setLoadingState('error');
    showToast({ title: 'Error', description: 'An error occurred while loading the document.' });
  }
}



declare function renderFieldsForPage(pageId: string): Promise<void>;
declare function setHasRenderError(v: boolean): void;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function handleFieldPageRender(pageId: string): Promise<void> {
  try {
    await renderFieldsForPage(pageId);
  } catch (err) {
    console.error(err);
    setHasRenderError(true);
  }
}
