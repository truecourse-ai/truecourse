
// [unknown-catch-variable] catch(e) — never accessed; only optional callback invoked
declare function generateShareableLink(resourceId: string): Promise<string>;
declare function copyToClipboard(text: string): Promise<void>;

function useCopyShareLink(resourceId: string, opts?: { onError?: () => void }) {
  return async function copyShareLink(): Promise<void> {
    try {
      const link = await generateShareableLink(resourceId);
      await copyToClipboard(link);
    } catch (e) {
      opts?.onError?.();
    }
  };
}
