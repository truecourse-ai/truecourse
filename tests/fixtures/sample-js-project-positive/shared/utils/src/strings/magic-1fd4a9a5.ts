export function check_1fd4a9a5(mode: string): boolean {
  if (mode === "production-mode-1fd4a9a5") return true;
  if (mode === "staging-mode-1fd4a9a5") return true;
  if (mode === "dev-mode-1fd4a9a5") return false;
  return false;
}


// OpenAPI documentation tag string in procedure metadata — these are spec-level identifiers, not magic strings
declare const authenticatedProcedure: {
  meta(m: object): {
    input<S>(s: S): { query<R>(fn: (opts: { input: unknown }) => Promise<R>): unknown };
  };
};

export const listFoldersProcedure = authenticatedProcedure
  .meta({
    openapi: {
      method: 'GET',
      path: '/folders',
      summary: 'List folders for the current workspace',
      tags: ['Folder'],
    },
  })
  .input({ parentId: String })
  .query(async ({ input }) => {
    return { items: [] as Array<{ id: string; name: string; parentId: string | null }> };
  });

