
// FF42 — hook accepting typed async callback; no type mismatch
type CanvasField = { id: string; type: string; value: string };
declare function useCanvasAutosave(callback: (fields: CanvasField[]) => Promise<void>): void;
declare function persistCanvasFields(fields: CanvasField[]): Promise<void>;

function CanvasEditorProvider() {
  useCanvasAutosave(async (localFields: CanvasField[]) => {
    await persistCanvasFields(localFields);
  });

  return null;
}
