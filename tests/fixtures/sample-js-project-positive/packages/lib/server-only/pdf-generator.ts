
// --- no-void shape: module-level-or-non-react-async-init (void browser.close() in finally — fire-and-forget cleanup) ---
declare function launchBrowser(): Promise<{ newPage: () => Promise<{ pdf: () => Promise<Buffer>; goto: (url: string) => Promise<void> }>; close: () => Promise<void> }>;

async function generateAuditLogsPdf(url: string): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(url);
    return await page.pdf();
  } finally {
    void browser.close();
  }
}
