
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


// Shape: (window as unknown as { KonvaCanvas: typeof KonvaCanvas }).KonvaCanvas — canonical pattern
// for accessing a Playwright browser-injected global; TypeScript has no knowledge of runtime injection
declare namespace KonvaCanvas {
  class Stage { getChildren(): unknown[] }
}
declare const testPage: { evaluate: <T>(fn: () => T) => Promise<T> };

export async function countKonvaStageChildren(): Promise<number> {
  return testPage.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const Konva = (window as unknown as { KonvaCanvas: typeof KonvaCanvas }).KonvaCanvas;
    return Konva ? new Konva.Stage().getChildren().length : 0;
  });
}

