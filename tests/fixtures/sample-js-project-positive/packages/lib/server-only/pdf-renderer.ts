
// FF28 — Object.entries destructuring in for...of; correctly typed
type FieldsByPage = Record<string, Array<{ id: string; type: string; x: number; y: number }>>;
declare const fieldsByPage: FieldsByPage;

async function renderAllPages() {
  for (const [pageNumber, fields] of Object.entries(fieldsByPage)) {
    console.log(`Rendering page ${pageNumber} with ${fields.length} fields`);
    for (const field of fields) {
      console.log(field.id, field.type);
    }
  }
}



// --- FP shape: shared stage mutated each iteration; toBuffer reads current state (sequential required) ---
declare const renderStage: {
  destroyChildren(): void;
  add(layer: unknown): void;
  toBuffer(): Promise<Buffer>;
};
declare function buildPageLayer(pageData: { content: string; index: number }): unknown;
declare const pages: Array<{ content: string; index: number }>;

async function renderPageBuffers(): Promise<Buffer[]> {
  const buffers: Buffer[] = [];
  for (const page of pages) {
    renderStage.destroyChildren();
    renderStage.add(buildPageLayer(page));
    const buf = await renderStage.toBuffer();
    buffers.push(buf);
  }
  return buffers;
}


// guarded-or-preinitialized-object-access: fieldParsers[field.type] guarded by if(parser) before use
declare const ZTextMeta: { safeParse: (x: unknown) => { success: boolean; data?: { fontSize?: number } } };
declare const ZNumberMeta: { safeParse: (x: unknown) => { success: boolean; data?: { fontSize?: number } } };
declare const ZDateMeta: { safeParse: (x: unknown) => { success: boolean; data?: { fontSize?: number } } };

const fieldParsers = {
  TEXT: ZTextMeta,
  NUMBER: ZNumberMeta,
  DATE: ZDateMeta,
} as const;

type FieldKind = { type: string; fieldMeta: unknown };

function resolveFieldFontSize(field: FieldKind, defaultSize: number): number {
  const parser = fieldParsers[field.type as keyof typeof fieldParsers];
  const result = parser ? parser.safeParse(field.fieldMeta) : null;
  return (result?.success && result.data?.fontSize) ? result.data.fontSize : defaultSize;
}
