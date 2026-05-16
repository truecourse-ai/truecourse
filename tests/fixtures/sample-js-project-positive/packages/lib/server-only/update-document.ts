
// Snippet: function call with correctly-typed object argument — no type mismatch
declare function updateProjectSettings(opts: { projectId: number; title: string; externalId?: string; meta?: object }): Promise<void>;
declare const projectId: number;
declare const title: string;
declare const externalId: string | undefined;

export async function saveProjectSettings() {
  await updateProjectSettings({
    projectId,
    title,
    externalId,
    meta: { version: 2 },
  });
}
