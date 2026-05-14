
// FP: (window as unknown as { PixiJS: typeof PixiJS }).PixiJS is the canonical pattern
// to access a browser-injected global from Playwright. This is not unsafe.
declare namespace PixiJS {
  class Application { stage: unknown }
}
declare const page: { evaluate: <T>(fn: () => T) => Promise<T> };

async function getPixiStageElementCount(): Promise<number> {
  return await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const pixi: typeof PixiJS = (window as unknown as { PixiJS: typeof PixiJS }).PixiJS;
    return pixi ? 1 : 0;
  });
}
