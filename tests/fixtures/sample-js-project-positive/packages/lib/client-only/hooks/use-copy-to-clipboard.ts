
// [unknown-catch-variable] catch(error) — only console.warn with error as value; no property access
declare function copyTextToClipboard(text: string): Promise<void>;

function createCopyToClipboardHook() {
  return async function copyToClipboard(value: string): Promise<boolean> {
    try {
      await copyTextToClipboard(value);
      return true;
    } catch (error) {
      console.warn('Copy failed', error);
      return false;
    }
  };
}
