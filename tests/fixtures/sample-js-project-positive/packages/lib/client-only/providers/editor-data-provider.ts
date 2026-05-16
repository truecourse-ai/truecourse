
// Pass-through: catch(err) passes err directly to console.error only
async function refreshEditorContent(editorId: string): Promise<void> {
  try {
    await loadEditorData(editorId);
  } catch (err) {
    console.error(err);
  }
}

declare function loadEditorData(id: string): Promise<void>;
