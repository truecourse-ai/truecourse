
declare function writeTextToClipboard(text: string): Promise<void>;

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await writeTextToClipboard(text);
    return true;
  } catch (error) {
    console.warn('Copy failed', error);
    return false;
  }
}
