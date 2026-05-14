// Single hook reads a data attribute — one usage, not a meaningful duplicate
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare const document: { querySelectorAll(sel: string): NodeListOf<HTMLElement> };

function useScrollToAnchor(anchorId: string | null) {
  useEffect(() => {
    if (!anchorId) return;
    const targets = document.querySelectorAll('[data-scroll-to-anchor]');
    targets.forEach((el) => {
      if (el.getAttribute('data-scroll-to-anchor') === anchorId) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }, [anchorId]);
}



// safe-value-pass-no-property-access: catch(err) only console.error(err) and setRenderError(true); no unsafe property access
declare function renderFieldsPage(pageIndex: number): Promise<HTMLElement>;
declare function setRenderError(hasError: boolean): void;

async function loadFieldsPage(pageIndex: number): Promise<HTMLElement | null> {
  try {
    return await renderFieldsPage(pageIndex);
  } catch (err) {
    console.error(err);
    setRenderError(true);
    return null;
  }
}



// instanceof-narrowed-before-access: catch(err) narrowed with instanceof Error before .name; safely handles non-Error case
declare function loadPdfPage(url: string, pageNum: number): Promise<ImageData>;
declare function setPageError(msg: string): void;

async function renderPdfPage(url: string, pageNum: number): Promise<ImageData | null> {
  try {
    return await loadPdfPage(url, pageNum);
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'PasswordException') {
        setPageError('This PDF is password protected');
      } else {
        setPageError('Failed to render page');
      }
    } else {
      setPageError('Failed to render page');
    }
    return null;
  }
}
